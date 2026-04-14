# Call Transfer Handoff (Fuente de Verdad)

> Última actualización: 2026-04-13 (noche)  
> Objetivo: evitar regresiones de flujo de transferencia y cambios innecesarios en nuevos chats.

## Resumen Ejecutivo
- El primer punto de contacto sigue siendo el agente de voz en Vapi.
- El failover entre agentes humanos es secuencial (round robin): 1 -> 2 -> 3 -> 4.
- Si un agente no contesta, está ocupado, falla, o cae en buzón, se intenta el siguiente.
- El dashboard debe mostrar:
  - quién no respondió (nombre + motivo)
  - quién respondió (nombre)
  - por cuántos agentes pasó la llamada

## Flujo Actual Estable
1. Se crea llamada Vapi con `selected_agent` (índice inicial 0 cuando round robin está activo).
2. Vapi solicita `transfer-destination-request`.
3. API responde `destination` (número actual del agente seleccionado).
4. Twilio dispara callbacks de status del transfer leg.
5. Backend detecta estado y decide:
   - `human-answered`: se registra agente respondido.
   - `no-answer | busy | failed | voicemail`: failover inmediato al siguiente.
   - `status-update: ended` del parent: también dispara failover inmediato (si aplica).
   - si no llega `DialCallStatus` de Twilio, se usa fallback desde `status-update` para no trabar RR.
   - si child leg queda `queued/ringing` durante toda la ventana, escalar por timeout (`child_calls_still_pending_timeout`).
   - protección anti-duplicado evita doble failover por eventos fuera de orden.
6. Métricas agregan pasos de failover y razones por agente.
7. Dashboard consume esos campos y muestra nombres/motivos.

## Decisiones Críticas (NO romper)
1. `transfer-destination-request` debe responder `destination` a Vapi (no iniciar Twilio-first inicial aquí).
2. Mantener auto-transfer por `speech-update` para Brenda, para evitar bucles de confirmación.
   - Default recomendado: `BRENDA_TRANSFER_TRIGGER_STATUS=stopped`.
   - No cambiar a `started` sin prueba real end-to-end.
3. No depender solo de polling de child calls; usar callbacks Twilio para razón real de fallo.
4. Child-call polling debe ser corto (no 15 intentos).
5. Cuando Twilio llama al endpoint configurado en `<Dial action=...>`, responder SIEMPRE TwiML válido.
   - Si se responde texto plano (`ok`) puede sonar: `"we are sorry an application error has occurred, goodbye"`.
   - Respuesta segura: `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`.
6. Escapar URLs en atributos XML de TwiML (`action`, `statusCallback`, `amdStatusCallback`, etc.).
   - Si `callbackUrl` lleva query params, `&` debe ir escapado como `&amp;`.
7. En `<Dial>`, usar grabación nativa para el transfer leg:
   - `record="record-from-answer-dual"`
   - `recordingStatusCallback=".../webhooks/twilio/recording-status?..."`
8. Recording callback de Twilio puede venir por parent o child leg.
   - Resolver métrica por `twilioTransferCallSid` o `twilioParentCallSid` (y `ParentCallSid`/`vapi_call_id` si vienen).
9. El botón `Sincronizar solo esta llamada` debe consultar Twilio (no solo Vapi):
   - buscar child leg por parent sid
   - fallback a recording de parent leg
   - poblar `transferRecordingUrl`, duración y `transferTranscript` (si transcripción habilitada)
10. No marcar `transfer_success` solo porque existe transfer intent o `assistant-forwarded-call`.
   - Confirmar con evidencia de conexión humana (`transferStatus` conectado y/o duración post-transfer confiable).
11. Si faltan callbacks Twilio en producción, RR debe seguir avanzando vía fallback de `status-update`.
   - No depender de un solo tipo de callback para escalar de agente.

## Configuración Recomendada

### Variables (API)
- `TRANSFER_FAILOVER_RING_TIMEOUT_SEC=15`
- `TRANSFER_CHILD_CALL_MAX_ATTEMPTS=12`
- `TRANSFER_CHILD_CALL_POLL_INTERVAL_MS=1200`
- `TRANSFER_CHILD_CALL_MAX_WAIT_MS` opcional (si se usa, no exceder lo necesario)
- `BRENDA_TRANSFER_TRIGGER_STATUS=stopped`
- `PUBLIC_API_BASE_URL` / `API_BASE_URL` recomendado
  - fallback automático: `RAILWAY_PUBLIC_DOMAIN`

### Twilio `<Dial><Number>`
Debe incluir:
- `statusCallback`
- `statusCallbackEvent="initiated ringing answered completed busy no-answer failed canceled"`
- `machineDetection="DetectMessageEnd"`
- `amdStatusCallback`
- `record="record-from-answer-dual"`
- `recordingStatusCallback`

## Mapeo de Motivos por Agente
- `human-answered`: contestó humano.
- `voicemail`: `AnsweredBy` de Twilio indica `machine_*` o `fax`.
- `no-answer`: no contestó dentro del tiempo.
- `busy`: ocupado.
- `failed`: error/cancelación de leg.

## Señales de Salud Esperadas en `/api/metrics/calls/:callId`
- `roundRobinFailedAgents[].name` poblado.
- `roundRobinFailedAgents[].result` poblado (`no-answer`, `busy`, `failed`, `voicemail`).
- `roundRobinAnsweredAgentName` poblado cuando hubo conexión humana real.
- `roundRobinAgentsTriedCount` consistente con failovers.
- `roundRobinFirstAgentResult` visible (`voicemail`, `no-answer`, `busy`, `failed`, `human-answered`).

## Síntomas Conocidos y Diagnóstico Rápido
1. "El agente confirma transferencia y no debería":
   - revisar prompt del asistente en Vapi Dashboard
   - validar que auto-transfer por `speech-update` siga habilitado
2. "Se escucha error de app después de tonos":
   - validar que `transfer-destination-request` no esté forzando ruta Twilio-first inicial
   - validar que `/webhooks/twilio/transfer-status` responda TwiML en callbacks `DialCallStatus`
   - validar que `status-update: ended` esté disparando failover y no se esté saltando
3. "No hay child calls / no recording":
   - revisar callbacks Twilio y que `statusCallback` llegue a `/webhooks/twilio/transfer-status`
   - confirmar logs de fallback: `RR fallback failover from status-update (missing DialCallStatus)`
4. "Dashboard muestra transfer conectada pero agente nunca contestó":
   - revisar que `transfer_success` no se derive solo de `endedReason`
   - validar `transferStatus`, `postTransferDurationSec` y evidencia de leg conectada
5. "Se conectó con humano pero no hay audio/transcript de transfer":
   - revisar `twilio/recording-status` callback (parent o child sid)
   - usar `POST /api/metrics/calls/:callId/sync` para enriquecimiento puntual desde Twilio
   - validar que exista `transferRecordingUrl` en `CallMetric`

## Checklist Antes de Cerrar un Cambio
- [ ] Build API OK (`npm -w apps/api run build`)
- [ ] Build dashboard OK (`npm run build` en `dashboard-v2`)
- [ ] Prueba real con 2+ agentes (uno sin contestar)
- [ ] Verificar en detalle de llamada:
  - [ ] nombre de no respondidos
  - [ ] motivo por no respondido
  - [ ] nombre del que respondió (si respondió alguien)
  - [ ] conteo de agentes intentados

## Commits de Referencia
- `935728d` Improve RR failover visibility, AMD voicemail handling, and faster child-call timeout
- `ac7ebe1` Restore Brenda auto-transfer and force Vapi destination flow
- `1eee20b` Fix(vapi): backend deja de sobreescribir prompt/firstMessage/model/tools
- `41e282b` Fix(twiml): escapar callback URLs en atributos XML de `<Dial>`
- `32f02df` Fix(twilio): grabar transfer leg desde `<Dial>` con `recordingStatusCallback`
- `d5949a3` Fix(metrics): normalizar outcome/sentiment con señales Twilio
- `4acc8a5` Fix(metrics-sync): sync de llamada también enriquece transfer recording/transcript desde Twilio
- `381192b` Fix(twilio-recording): resolver recordings por parent o child leg
