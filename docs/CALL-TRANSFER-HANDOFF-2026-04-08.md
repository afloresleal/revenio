# Call Transfer Handoff (Fuente de Verdad)

> Última actualización: 2026-04-08  
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
6. Métricas agregan pasos de failover y razones por agente.
7. Dashboard consume esos campos y muestra nombres/motivos.

## Decisiones Críticas (NO romper)
1. `transfer-destination-request` debe responder `destination` a Vapi (no iniciar Twilio-first inicial aquí).
2. Mantener auto-transfer por `speech-update` para Brenda, para evitar bucles de confirmación.
3. No depender solo de polling de child calls; usar callbacks Twilio para razón real de fallo.
4. Child-call polling debe ser corto (no 15 intentos).

## Configuración Recomendada

### Variables (API)
- `TRANSFER_FAILOVER_RING_TIMEOUT_SEC=15`
- `TRANSFER_CHILD_CALL_MAX_ATTEMPTS=4`
- `TRANSFER_CHILD_CALL_POLL_INTERVAL_MS=1200`
- `TRANSFER_CHILD_CALL_MAX_WAIT_MS` opcional (si se usa, no exceder lo necesario)

### Twilio `<Dial><Number>`
Debe incluir:
- `statusCallback`
- `statusCallbackEvent="initiated ringing answered completed busy no-answer failed canceled"`
- `machineDetection="DetectMessageEnd"`
- `amdStatusCallback`

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

## Síntomas Conocidos y Diagnóstico Rápido
1. "El agente confirma transferencia y no debería":
   - revisar prompt del asistente en Vapi Dashboard
   - validar que auto-transfer por `speech-update` siga habilitado
2. "Se escucha error de app después de tonos":
   - validar que `transfer-destination-request` no esté forzando ruta Twilio-first inicial
3. "No hay child calls / no recording":
   - revisar callbacks Twilio y que `statusCallback` llegue a `/webhooks/twilio/transfer-status`

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

