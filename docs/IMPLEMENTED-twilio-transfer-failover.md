# Twilio Setup: Transfer Failover (5s) para Round Robin Humano

## Objetivo
Habilitar callbacks de Twilio en el **transfer leg** (llamada al agente humano) para que el backend pueda:
- detectar `ringing` y esperar 5 segundos
- escalar al siguiente agente si no contesta
- escalar inmediatamente en `busy/no-answer/failed/canceled`

Sin estos callbacks, el backend queda en modo `vapi_only` y no hay failover real.
Con fallback actual, si Twilio no manda `DialCallStatus`, RR escala desde `status-update` para no bloquearse.

## Contexto técnico (Revenio)
- API base de webhooks: `https://<TU_API_PUBLICA>/webhooks/twilio/...`
- Endpoints ya implementados:
  - `POST /webhooks/twilio/transfer-status`
  - `POST /webhooks/twilio/transfer-recording`
  - `POST /webhooks/twilio/transfer-transcription`
- Timeout de failover: `TRANSFER_FAILOVER_RING_TIMEOUT_SEC` (default: `5`)
- Ventana de espera de child call (`queued/ringing` antes de failover):
  - `TRANSFER_CHILD_CALL_MAX_WAIT_MS` (default: `9000`)
  - `TRANSFER_CHILD_CALL_POLL_INTERVAL_MS` (default: `1200`)
  - `TRANSFER_CHILD_CALL_MAX_ATTEMPTS` (recomendado actual: `12`)

## Base URL recomendada
Para evitar callbacks apuntando a dominio incorrecto:
- definir `PUBLIC_API_BASE_URL` (o `API_BASE_URL`) con el dominio público real de Railway.
- fallback soportado por backend: `RAILWAY_PUBLIC_DOMAIN`.

## Tarea para clawdbot (Twilio Console/API)
Configurar la llamada transferida (child leg) para enviar callbacks a Revenio.

### 1) Status callback (obligatorio para failover)
Configurar en el transfer leg:
- `StatusCallback`: `https://<TU_API_PUBLICA>/webhooks/twilio/transfer-status`
- `StatusCallbackMethod`: `POST`
- `StatusCallbackEvent`:
  - mínimo: `initiated`, `ringing`, `answered`, `completed`
  - ideal también: `busy`, `no-answer`, `failed`, `canceled` (si Twilio los soporta en ese flujo)

#### Respuesta del callback `<Dial action=...>` (crítico)
Cuando Twilio pega al callback de `Dial` (`/webhooks/twilio/transfer-status`), el backend debe responder TwiML válido.
- Correcto: `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`
- Incorrecto: `ok`, texto plano o JSON en ese callback

Si se responde inválido, Twilio puede reproducir:
`"we are sorry an application error has occurred, goodbye"`

#### XML escaping (crítico)
Si `action`/`statusCallback` llevan query params, deben ir escapados en TwiML:
- usar `&amp;` en lugar de `&` dentro de atributos XML.
- esto evita XML inválido y el mensaje de error de aplicación de Twilio.

### 2) Recording callback (recomendado)
- `RecordingStatusCallback`: `https://<TU_API_PUBLICA>/webhooks/twilio/transfer-recording`
- `RecordingStatusCallbackMethod`: `POST`
- habilitar grabación del transfer leg desde `<Dial>`:
  - `record="record-from-answer-dual"`
  - `recordingStatusCallback="https://<TU_API_PUBLICA>/webhooks/twilio/recording-status?..."`

Nota importante:
- Twilio puede reportar recording en `CallSid` de parent o de child leg.
- backend debe resolver ambos casos al guardar `transferRecordingUrl`.

### 3) Transcription callback (opcional recomendado)
- `TranscriptionCallback`: `https://<TU_API_PUBLICA>/webhooks/twilio/transfer-transcription`
- `TranscriptionTrack`: `both` (si aplica)

## Verificación rápida
Después de configurar, ejecutar 1 llamada de prueba donde el primer agente no conteste.

Esperado en métricas/detalle:
- `twilioTransferCallSid` != `null`
- `transferStatus` debe moverse (`ringing` y luego estado final o nuevo intento)
- failover a siguiente agente dentro de ~5s
- si todos fallan: estado interno `transfer-failover-exhausted`
- si no llega callback Twilio, debe verse fallback en logs:
  - `RR fallback failover from status-update (missing DialCallStatus)`
- si llega `status-update: ended` antes de otros eventos, igual debe escalar y no quedarse trabado.

Esperado en clasificación:
- `transfer_success` solo con evidencia de conexión humana (status conectado y/o duración post-transfer confiable).
- No clasificar éxito solo por `assistant-forwarded-call`.

Esperado en detalle API (`GET /api/metrics/calls/:callId`):
- `dataQuality.mode` deja de ser `vapi_only`
- aparecen señales Twilio (`twilioParentCallSid`, `twilioTransferCallSid`, `transferStatus`)
- aparecen campos de trazabilidad RR:
  - `roundRobinFirstAgentResult`
  - `roundRobinFirstAgentName`
  - `roundRobinFirstAgentNumber`

## Recuperación manual (dashboard)
Si una llamada sí tuvo vendedor (`postTransferDurationSec > 0`) pero falta audio/transcript:
- usar botón **Sincronizar solo esta llamada**
- endpoint: `POST /api/metrics/calls/:callId/sync`
- sincroniza desde Vapi + Twilio y ahora intenta:
  - child leg recording
  - fallback a parent leg recording
  - transcripción (si `OPENAI_API_KEY` o whisper local habilitado)

## Señales de que sigue mal configurado
Si aún ves:
- `twilioTransferCallSid: null`
- `transferStatus: null`
- `dataQuality.mode: "vapi_only"`

entonces Twilio no está enviando callbacks del transfer leg al endpoint correcto.

## Checklist final para clawdbot
- [ ] URL pública HTTPS correcta
- [ ] `transfer-status` configurado en child leg
- [ ] Eventos de status habilitados (incluyendo `ringing`)
- [ ] Sin bloqueo de auth/firewall para Twilio
- [ ] Prueba real ejecutada y confirmada con `callId`/capturas
