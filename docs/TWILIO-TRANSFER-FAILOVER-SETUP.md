# Twilio Setup: Transfer Failover (5s) para Round Robin Humano

## Objetivo
Habilitar callbacks de Twilio en el **transfer leg** (llamada al agente humano) para que el backend pueda:
- detectar `ringing` y esperar 5 segundos
- escalar al siguiente agente si no contesta
- escalar inmediatamente en `busy/no-answer/failed/canceled`

Sin estos callbacks, el backend queda en modo `vapi_only` y no hay failover real.

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

### 2) Recording callback (recomendado)
- `RecordingStatusCallback`: `https://<TU_API_PUBLICA>/webhooks/twilio/transfer-recording`
- `RecordingStatusCallbackMethod`: `POST`
- habilitar grabación del child leg

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

Esperado en clasificación:
- `transfer_success` solo con evidencia de conexión humana (status conectado y/o duración post-transfer confiable).
- No clasificar éxito solo por `assistant-forwarded-call`.

Esperado en detalle API (`GET /api/metrics/calls/:callId`):
- `dataQuality.mode` deja de ser `vapi_only`
- aparecen señales Twilio (`twilioParentCallSid`, `twilioTransferCallSid`, `transferStatus`)

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
