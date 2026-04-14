# Revenio Call Campaign

Monorepo para operacion de llamadas outbound con Vapi + Twilio.

Incluye:
- API en Node/Express + Prisma + PostgreSQL (`apps/api`)
- Lab UI para pruebas manuales (`apps/lab`)
- Dashboard React/Vite para metricas (`dashboard-v2`)

---

## 1) Arquitectura (resumen)

### Flujo principal
1. Se crea/recibe un lead.
2. API dispara llamada via `POST /call/test`, `POST /call/test/direct` o `POST /call/vapi`.
3. Vapi y Twilio envian eventos a `/webhooks/*`.
4. API consolida eventos y metricas en `CallAttempt`, `Event` y `CallMetric`.
5. Lab y Dashboard consultan la API (`/lab/*` y `/api/metrics/*`).

### Voice agents (multi-idioma)
El backend soporta asistentes en ES/EN y respeta configuración de Vapi como fuente de verdad:
- prompt y first message se configuran en Vapi
- backend solo envía `assistantOverrides.variableValues` (ej. `name`) + metadata

Referencia: [docs/VAPI-CONFIG.md](docs/VAPI-CONFIG.md)

---

## 2) Estructura del repo

```text
.
├─ apps/
│  ├─ api/              # API principal
│  └─ lab/              # UI estatica para debug
├─ dashboard/           # Dashboard legacy (vanilla)
├─ dashboard-v2/        # Dashboard actual (React + Vite)
├─ docs/
├─ docker-compose.yml
└─ package.json         # workspaces (apps/*, packages/*)
```

---

## 3) Stack

- Node.js 22+
- npm workspaces
- Express 4
- Prisma 5 + PostgreSQL
- Frontend: vanilla JS (Lab) + React 19 / Vite (Dashboard v2)

---

## 4) Configuracion local

### Requisitos
- Node 22+
- PostgreSQL accesible

### Instalar dependencias
En la raiz:

```bash
npm ci
```

Para dashboard v2 (no vive en workspaces):

```bash
npm --prefix dashboard-v2 ci
```

### Variables de entorno (API)
Crear `.env` (raiz o `apps/api/.env`).

Minimas para llamadas Vapi:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB
PORT=3000

VAPI_API_KEY=sk_...
VAPI_ASSISTANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VAPI_PHONE_NUMBER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Variables comunes opcionales:

```bash
# CORS
DASHBOARD_URL=http://localhost:5173

# Transfer
TRANSFER_NUMBER=+52...
HUMAN_AGENT_NUMBERS=+5255...,+5255...,+5255...
HUMAN_AGENT_NAMES=Ana,Luis,Sofia
TRANSFER_CONNECTED_MIN_SEC=10

# Twilio (duracion post-transfer, grabaciones, callbacks)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...

# Transcripcion
TRANSCRIPTION_PROVIDER=auto
OPENAI_API_KEY=...
OPENAI_AUDIO_MODEL=whisper-1
OPENAI_TRANSCRIBE_TIMEOUT_MS=45000
WHISPER_LOCAL_ENABLED=false
WHISPER_LOCAL_BIN=whisper
WHISPER_LOCAL_MODEL=base
WHISPER_LOCAL_LANGUAGE=es
WHISPER_LOCAL_TIMEOUT_MS=180000
RECORDING_DOWNLOAD_TIMEOUT_MS=45000

# Jobs y backfill
SYNC_TRANSFER_DEFAULT_LOOKBACK_MIN=180
METRICS_BACKFILL_LIMIT=100
METRICS_BACKFILL_MAX_LIMIT=500

# Enlaces webhook generados por API
WEBHOOK_BASE_URL=https://tu-api-publica
PUBLIC_API_BASE_URL=https://tu-api-publica
API_BASE_URL=https://tu-api-publica
# En Railway, si no defines PUBLIC/API_BASE_URL, se usa:
# RAILWAY_PUBLIC_DOMAIN
```

### Migraciones Prisma

```bash
npm -w apps/api exec prisma migrate deploy
```

---

## 5) Ejecutar en local

### API

```bash
npm run dev
```

API por defecto: `http://localhost:3000`

### Lab UI

```bash
npm run lab
```

Lab por defecto: `http://localhost:5174`

### Dashboard v2

```bash
npm --prefix dashboard-v2 run dev
```

Dashboard v2 por defecto: `http://localhost:5173`

Si necesitas apuntar a otra API:

```bash
VITE_API_URL=http://localhost:3000
```

---

## 6) Endpoints principales

### Salud
- `GET /health`

### Leads
- `POST /lead`
- `GET /lead/:id`
- `GET /leads`

### Llamadas
- `POST /call/test`
- `POST /call/test/direct`
- `POST /call/vapi` (produccion, valida horario 7:00-22:00 CST)

`POST /call/vapi` soporta round robin opcional (hasta 5 agentes):
- Request: `round_robin_enabled: true`
- Request: `round_robin_agents: [{ name?, transfer_number }]` (max 5)
- O por ENV: `HUMAN_AGENT_NUMBERS` (+ `HUMAN_AGENT_NAMES` opcional, listas separadas por coma)
- Si `round_robin_enabled` es `true`, selecciona el humano por rotación y devuelve `selected_agent` en la respuesta.

### Lab / debug
- `GET /lab/history`
- `POST /lab/sync-attempt/:id`
- `GET /lab/call-status/:id`
- `POST /vapi/validate`
- `POST /vapi/assistants`
- `POST /vapi/phone-numbers`

### Metricas
Base: `/api/metrics`

- `GET /summary`
- `GET /daily`
- `GET /recent`
- `GET /calls/:callId`
- `POST /calls/:callId/transcribe-full`
- `POST /calls/:callId/sync`
- `POST /transcribe-missing`
- `POST /backfill`
- `POST /backfill/run`

### Jobs
Base: `/api/jobs`

- `POST /sync-transfer-metrics`
  - Query opcionales: `limit`, `lookback_minutes`, `dry_run`

### Webhooks
Base: `/webhooks`

Vapi:
- `POST /vapi/events` (endpoint unificado recomendado)
- `POST /vapi/metrics`
- `POST /vapi/end-of-call`
- `POST /vapi/transfer`

Twilio:
- `POST /twilio/recording-status`
- `POST /twilio/transcription-complete`
- `POST /twilio/retranscribe/:callId`

Recordings proxy:
- `GET /api/recordings/:recordingSid`

### Guardrails (transfer/failover)
- `BRENDA_TRANSFER_TRIGGER_STATUS=stopped` recomendado para auto-transfer estable.
- En callbacks de Twilio `Dial action` (`/webhooks/twilio/transfer-status`), la respuesta debe ser TwiML válido.
  - Si se responde texto plano, Twilio puede cortar con mensaje de error de aplicación.
- RR debe escalar también en `status-update: ended` (no esperar solo `DialCallStatus`).
- Si Twilio no envía `DialCallStatus`, usar fallback desde `status-update` para evitar llamadas trabadas.
- Proteger contra doble failover por eventos fuera de orden (cooldown anti-duplicado).
- Si el transfer leg queda `ringing/queued` toda la ventana de espera, escalar por timeout (`child_calls_still_pending_timeout`).
- Escapar XML en URLs de TwiML (`&` -> `&amp;`) para evitar audio Twilio "application error".
- En `<Dial>`, habilitar grabación nativa (`record="record-from-answer-dual"` + `recordingStatusCallback`).
- `transfer_success` debe representar conexión humana real, no solo intento de transfer.
- Runbook operativo: [docs/CALL-TRANSFER-HANDOFF-2026-04-08.md](docs/CALL-TRANSFER-HANDOFF-2026-04-08.md)
- Setup Twilio detallado: [docs/TWILIO-TRANSFER-FAILOVER-SETUP.md](docs/TWILIO-TRANSFER-FAILOVER-SETUP.md)

---

## 9) Contexto rápido (para retomar en nuevo chat)

Estado operativo al cierre (2026-04-13):
- Brenda auto-transfiere en `speech-update` (`assistantId` fijo de Brenda, sin depender de `turn`).
- Backend no sobreescribe prompt/firstMessage/model/tools de Vapi (Vapi manda el guion).
- Round robin secuencial activo (1 -> 2 -> 3), con failover por:
  - `busy/no-answer/failed/voicemail`
  - `status-update` sin `DialCallStatus` (fallback)
  - timeout de pending (`queued/ringing`) al agotar ventana.
- TwiML usa callback URLs escapadas en XML y `recordingStatusCallback` en `<Dial>`.
- Métricas normalizan outcome/sentiment con señales reales de Twilio:
  - evita mostrar `abandoned/negative` cuando hubo conexión humana.
- Botón `Sincronizar solo esta llamada` ahora enriquece desde Twilio (child y parent leg) para recuperar recording/transcript faltante.

Checklist corto cuando algo falle:
1. Revisar logs por `twilio_status_webhook_hit` y `twilio_transfer_status_response`.
2. Verificar `callbackUrl` y `recordingCallbackUrl` en logs (dominio correcto de Railway).
3. Confirmar en detalle:
   - `twilioParentCallSid`
   - `twilioTransferCallSid`
   - `transferStatus`
   - `postTransferDurationSec`
4. Si falta audio humano, usar `Sincronizar solo esta llamada` y reabrir detalle.

---

## 7) Configuracion Vapi recomendada

En Vapi (server messages/webhooks):
- URL recomendada: `https://<tu-api>/webhooks/vapi/events`
- Activar al menos `end-of-call-report` y eventos de transfer

Sin esto, no se consolidan bien transcript, outcome ni metricas de transfer.

---

## 8) Deploy (Railway)

Servicios tipicos:
1. API (`apps/api`)
2. Lab (opcional separado)
3. Postgres

Checklist post-deploy:
1. `GET /health` responde `{ ok: true, service: "revenio-api" }`
2. Ejecutar llamada de prueba (`/call/test/direct`)
3. Verificar registros en `/lab/history`
4. Validar panel en `/api/metrics/summary` y `/api/metrics/recent`

---

## 9) Troubleshooting rapido

### `missing_vapi_config`
Faltan `VAPI_API_KEY`, `VAPI_ASSISTANT_ID` o `VAPI_PHONE_NUMBER_ID`.

### `outside_business_hours`
`POST /call/vapi` fuera de la ventana permitida (7:00-22:00 CST).

### Llamada enviada pero sin audio/resultado
1. Revisar estado con `GET /lab/call-status/:attemptId`
2. Confirmar webhook Vapi a `/webhooks/vapi/events`
3. Revisar eventos recientes en `/lab/history`

### No hay transcript
1. Confirmar que llega `end-of-call-report`
2. Ejecutar `POST /lab/sync-attempt/:id`
3. Si aplica transfer + grabacion, usar `POST /webhooks/twilio/retranscribe/:callId`

### `P1001 Can't reach database`
Validar `DATABASE_URL` correcta para el entorno (local vs Railway interna/publica).

---

## 10) Comandos utiles

```bash
# Build API
npm -w apps/api run build

# Migraciones deploy
npm -w apps/api exec prisma migrate deploy

# Lab UI
npm run lab

# Dashboard v2
npm --prefix dashboard-v2 run dev

# Estado git
git status --short
```
