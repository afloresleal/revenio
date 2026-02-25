# Revenio Call Campaign

Monorepo para pruebas y operación de llamadas outbound con Vapi/Twilio.

Incluye:
- API en Node/Express + Prisma + PostgreSQL
- UI de laboratorio (`/`) para depuración operativa
- Landing simplificada (`/campaign.html`) para usuarios no técnicos

---

## 1) Arquitectura (resumen)

### Flujo principal
1. Usuario envía `nombre` + `telefono` en `/campaign.html`.
2. Frontend llama `POST /call/test/direct` al API.
3. API crea `Lead` + `CallAttempt` y dispara llamada en Vapi (`/call/phone`).
4. Vapi envía resultados a webhook (`/webhooks/vapi/result`).
5. API guarda eventos (`Event`) y JSON final (`CallAttempt.resultJson`).
6. Lab consulta historial por `GET /lab/history`.

### Componentes
- `apps/api`: backend principal.
- `apps/lab`: servidor estático con:
  - `index.html` (Lab)
  - `campaign.html` (landing de campaña)

### Voice Agents (Multi-idioma)

El sistema soporta 3 asistentes de voz con detección automática de idioma:

| Agente | Idioma | Greeting | Uso |
|--------|--------|----------|-----|
| **Marina** (1-ES-F) | Español | "Hola, ¿hablo con {name}?" | Leads hispanohablantes |
| **Rachel** (2-EN-F) | English | "Hi, am I speaking with {name}?" | English leads (professional) |
| **Bella** (3-EN-F) | English | "Hi! Am I talking to {name}?" | English leads (friendly) |

La API detecta automáticamente el idioma según el `assistantId` y genera:
- First message en el idioma correcto
- Transfer message localizado
- System prompt apropiado

Ver [docs/VAPI-CONFIG.md](docs/VAPI-CONFIG.md) para configuración detallada.

---

## 2) Estructura del repo

```text
.
├─ apps/
│  ├─ api/
│  │  ├─ src/server.ts
│  │  ├─ prisma/schema.prisma
│  │  └─ prisma/migrations/
│  └─ lab/
│     ├─ server.js
│     └─ public/
│        ├─ index.html
│        ├─ app.js
│        ├─ campaign.html
│        ├─ campaign.js
│        └─ *.css
├─ package.json (workspaces)
└─ docker-compose.yml
```

---

## 3) Stack y versiones

- Node.js 22.x (Railway build actual: Node 22)
- npm workspaces
- Express 4
- Prisma 5 + PostgreSQL
- Frontend vanilla JS/HTML/CSS

---

## 4) Configuración local

## Requisitos
- Node 22+
- PostgreSQL accesible

## Instalar dependencias
```bash
npm ci
```

## Variables de entorno (API)
Crear `.env` en raíz (o en `apps/api` según tu flujo) con:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB
PORT=3000

VAPI_API_KEY=sk_...
VAPI_ASSISTANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VAPI_PHONE_NUMBER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Notas:
- `VAPI_API_KEY` debe ser **private/server key**.
- La landing simplificada no pide keys; usa estas variables del backend.

## Migraciones Prisma
```bash
npm -w apps/api exec prisma migrate deploy
```

## Ejecutar en local
API:
```bash
npm run dev
```

Lab UI:
```bash
npm run lab
```

Por defecto:
- API: `http://localhost:3000`
- Lab: `http://localhost:5174`

---

## 5) Endpoints relevantes

## Salud
- `GET /health`

## Leads / llamadas
- `POST /lead`
- `GET /lead/:id`
- `GET /leads`
- `POST /call/test`
- `POST /call/test/direct`

## Webhooks
- `POST /webhooks/twilio/status`
- `POST /webhooks/vapi/result`

## Utilidades lab
- `GET /lab/history`
- `POST /lab/sync-attempt/:id` (fallback para traer transcript/estado desde Vapi)
- `GET /lab/call-status/:id` (estado final por `attemptId`)

## Helpers Vapi (solo Lab/debug)
- `POST /vapi/validate`
- `POST /vapi/assistants`
- `POST /vapi/phone-numbers`

---

## 6) Configuración Vapi obligatoria

En el assistant/phone config de Vapi:
- Server URL:
  - `https://<tu-api>/webhooks/vapi/result`
- Server Messages:
  - activar al menos `end-of-call-report`

Sin esto, no llegarán `vapi_result` y no habrá transcript en historial.

---

## 7) Deployment en Railway

## Servicios recomendados
1. `@revenio/api` (Node API)
2. `honest-beauty` (Lab estático, si lo separan)
3. `Postgres`

## Variables en `@revenio/api`
- `DATABASE_URL` (apuntando al Postgres correcto del proyecto)
- `VAPI_API_KEY`
- `VAPI_ASSISTANT_ID`
- `VAPI_PHONE_NUMBER_ID`
- `PORT` (Railway lo inyecta, no forzar salvo caso especial)

## Post deploy checklist
1. `GET /health` responde `{ ok: true }`
2. Crear llamada de prueba desde landing
3. Verificar `vapi_result` en historial o usar `Sincronizar transcript`

---

## 8) Troubleshooting (runbook)

## A) `missing_vapi_config`
Faltan variables de Vapi en `@revenio/api`.

## B) `vapi_call_failed`
Vapi rechazó la llamada. Revisar `status/data` devuelto y `call-status`.

## C) Llamada "enviada" pero no sonó
Caso típico: Vapi acepta (`queued`) pero luego termina con error de transporte.
Consultar:
- `GET /lab/call-status/:attemptId`
- o Vapi call id directamente.

## D) Twilio Trial bloquea llamadas
Error común:
`The number ... is unverified. Trial accounts may only make calls to verified numbers.`

Acciones:
1. Verificar número destino en Twilio, o
2. Upgrade de cuenta Twilio.

## E) No aparece transcript
1. Confirmar webhook Vapi configurado.
2. Confirmar `vapi_result` en eventos.
3. Si no llegó webhook, usar botón `Sincronizar transcript` (Lab).

## F) `P1001 Can't reach database`
- Si sale `localhost`, estás usando `.env` local incorrecto para entorno remoto.
- En local usa URL pública de DB.
- En Railway usa `DATABASE_URL` interna del servicio.

---

## 9) Seguridad y operación

- No exponer API keys en frontend.
- Rotar keys si se filtran en screenshots/chats.
- Loggear `attemptId` y `providerId` en soporte/incidentes.
- Mantener webhook estable y monitorear 4xx/5xx.

---

## 10) Guía rápida por perfil

## Para dev junior
1. `npm ci`
2. Configura `.env`
3. Corre `npm run dev` y `npm run lab`
4. Prueba desde `/campaign.html`
5. Revisa historial en `/` (Lab)

## Para dev senior
- Verificar consistencia `attemptId <-> providerId <-> vapi_result`.
- Usar `/lab/call-status/:id` para diagnóstico de llamadas fantasma.
- Usar `/lab/sync-attempt/:id` para backfill sin webhook.
- Vigilar correlación entre Vapi callbacks y persistencia Prisma.

---

## 11) Comandos útiles

```bash
# Build API
npm -w apps/api run build

# Correr migraciones
npm -w apps/api exec prisma migrate deploy

# Ver estado de git
git status --short
```

