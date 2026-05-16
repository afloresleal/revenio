# CLAWDBOT HANDOFF: Revenio Call Campaign

Este documento resume todo el desarrollo realizado para la landing de llamadas de campaña, la API, el Lab, y la configuración operativa en Railway.

---

## 1) Objetivo del desarrollo

Construir una landing para disparar llamadas de campaña con campos mínimos:
- `nombre`
- `telefono`

Y mantener un flujo completo de observabilidad:
- creación de lead
- intento de llamada
- estado final
- transcript/audio cuando esté disponible

---

## 2) Arquitectura final

### Monorepo (npm workspaces)
- `apps/api`: API Node + Express + Prisma.
- `apps/lab`: UI estática (Lab + landing campaña).

### UIs
- `apps/lab/public/index.html`: Lab operativo (debug, historial, filtros, exportación).
- `apps/lab/public/campaign.html`: landing simplificada para usuarios no técnicos.

### Backend
- `apps/api/src/server.ts`: endpoints de negocio + webhooks + utilidades de sincronización.
- `apps/api/prisma/schema.prisma`: modelo `Lead`, `CallAttempt`, `Event`.

---

## 3) Flujo funcional actual

1. Usuario abre `campaign.html`.
2. Ingresa nombre y teléfono (E.164 recomendado).
3. Front llama `POST /call/test/direct`.
4. API:
   - crea `Lead` (si no existe),
   - crea `CallAttempt`,
   - llama a `https://api.vapi.ai/call/phone`,
   - guarda `providerId` (id de llamada Vapi).
5. Vapi llama webhook `POST /webhooks/vapi/result`.
6. API persiste `vapi_result` y actualiza `resultJson`.
7. Lab consulta historial (`GET /lab/history`) y renderiza estado/transcript/audio.

---

## 4) Cambios clave implementados

## A) Landing simplificada (sin credenciales visibles)
- Se removieron campos de API key / Assistant ID / Phone ID del frontend de campaña.
- `campaign.js` ahora envía solo datos de negocio:
  - `lead_name`
  - `to_number`
  - `lead_source`
- La configuración Vapi se resuelve en backend por variables de entorno.

## B) Seguridad / operación
- `POST /call/test/direct` ahora acepta credenciales opcionales en payload, pero usa fallback a:
  - `VAPI_API_KEY`
  - `VAPI_ASSISTANT_ID`
  - `VAPI_PHONE_NUMBER_ID`
- Resultado: socios/usuarios pueden probar la landing sin ver secretos.

## C) Robustez de webhooks
- Se agregó extracción de metadata también desde `assistantOverrides.metadata`.
- Para `vapi_result`, si no llega `attempt_id`, se hace fallback por `providerId` para vincular al `CallAttempt`.

## D) Recuperación de transcript cuando falla webhook
- Endpoint nuevo: `POST /lab/sync-attempt/:id`
  - consulta Vapi por `providerId`,
  - guarda evento `vapi_result`,
  - backfill de `resultJson`,
  - intenta construir transcript desde `messages` si no viene en `artifact.transcript`.

## E) Estado final de llamada (anti “falso positivo”)
- Endpoint nuevo: `GET /lab/call-status/:id`
  - trae estado real de Vapi (`status`, `endedReason`, `endedMessage`).
- `campaign.js` hace polling corto post-envío y muestra estado final entendible.

## F) UX de soporte en Lab
- Mejor mapeo de eventos por `attempt_id` y por `providerId`.
- Banner de outcome por intento:
  - estado final
  - mensaje de error final si aplica.
- Botón `Sincronizar transcript` para intentos sin `vapi_result`.

---

## 5) Configuración de Railway (hecha y requerida)

## Proyecto
- Nombre usado: `laudable-motivation`
- Environment: `production`

## Servicios
1. `@revenio/api` (backend principal).
2. `honest-beauty` (UI Lab + campaña).
3. `Postgres` (base de datos).

## Variables críticas en `@revenio/api`
- `DATABASE_URL` = referencia al Postgres del proyecto.
  - En Railway: usar la referencia del servicio Postgres (no localhost).
- `VAPI_API_KEY` = **private/server key** de Vapi.
- `VAPI_ASSISTANT_ID`
- `VAPI_PHONE_NUMBER_ID`
- `PORT` lo maneja Railway automáticamente.

## Variables en `honest-beauty` (si sirve app de Lab)
- `LAB_PORT=${{PORT}}` (para que el server estático escuche el puerto de Railway).

## Comportamiento de red/DB importante
- `postgres.railway.internal` funciona **dentro de Railway**, no desde Mac local.
- Para migrar desde local, usar Public URL temporal o correr migraciones en contexto del deploy.

## Deploy
- API compila con:
  - `npm run build --workspace=@revenio/api`
- Start:
  - `npm run start --workspace=@revenio/api`

---

## 6) Configuración de Vapi / Twilio necesaria

## Vapi (obligatorio)
- Server URL del assistant:
  - `https://<api-domain>/webhooks/vapi/result`
- Server Messages:
  - mínimo `end-of-call-report`.

## Twilio Trial (hallazgo operativo)
- Error validado en producción:
  - `The number ... is unverified. Trial accounts may only make calls to verified numbers.`
- Impacto:
  - API puede responder `ok: true` (llamada en queue) pero llamada termina sin sonar.
- Solución:
  - verificar número destino en Twilio, o subir cuenta de Twilio.

---

## 7) Endpoints relevantes (actuales)

- `GET /health`
- `POST /lead`
- `GET /lead/:id`
- `GET /leads`
- `POST /call/test`
- `POST /call/test/direct`
- `POST /webhooks/twilio/status`
- `POST /webhooks/vapi/result`
- `POST /vapi/validate`
- `POST /vapi/assistants`
- `POST /vapi/phone-numbers`
- `GET /lab/history`
- `POST /lab/sync-attempt/:id`
- `GET /lab/call-status/:id`

---

## 8) Runbook de troubleshooting

## 1. `missing_vapi_config`
Faltan variables Vapi en `@revenio/api`.

## 2. `vapi_call_failed`
Vapi rechazó el request. Revisar `status` y `data` de respuesta.

## 3. “Llamada enviada” pero no sonó
Consultar estado final por `GET /lab/call-status/:attemptId`.
Si `endedReason`/`endedMessage` indican Twilio trial/unverified, no es bug de backend.

## 4. No aparece transcript
Checklist:
1) confirmar webhook Vapi.
2) confirmar evento `vapi_result`.
3) usar `Sincronizar transcript` en Lab.

## 5. Error Prisma `P1001`
Revisar `DATABASE_URL`:
- si apunta a `localhost` en producción, está mal.
- si apunta a `*.internal` desde local, también fallará.

---

## 9) Archivos que concentran la lógica

- API:
  - `apps/api/src/server.ts`
  - `apps/api/prisma/schema.prisma`
- Frontend:
  - `apps/lab/public/campaign.html`
  - `apps/lab/public/campaign.js`
  - `apps/lab/public/index.html`
  - `apps/lab/public/app.js`
  - `apps/lab/public/styles.css`
  - `apps/lab/public/campaign.css`

---

## 10) Estado actual

Estado funcional general: **operativo**.

Capacidades ya cubiertas:
- landing simplificada sin exponer secretos,
- disparo de llamadas desde backend,
- historial centralizado,
- fallback para recuperar transcript/estado cuando webhook no llega o llega incompleto.

Riesgo operativo principal remanente:
- limitaciones de Twilio Trial para números no verificados.

