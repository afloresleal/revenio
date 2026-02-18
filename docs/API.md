# API Reference — Revenio

Base URL: `https://revenio-api.up.railway.app` (producción)

## Health

### GET /health

```bash
curl https://revenio-api.up.railway.app/health
```

**Response:**
```json
{"ok": true, "service": "revenio-api"}
```

---

## Leads

### POST /api/leads

Crear un nuevo lead.

```bash
curl -X POST https://revenio-api.up.railway.app/api/leads \
  -H "Content-Type: application/json" \
  -d '{"phone": "+525512345678", "name": "Juan Pérez", "campaign": "casalba"}'
```

**Body:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| phone | string | ✅ | Número con código país |
| name | string | ❌ | Nombre del lead |
| campaign | string | ❌ | Identificador de campaña |
| presupuesto | string | ❌ | Rango de presupuesto |
| source | string | ❌ | Origen (leadsbridge, manual) |

**Response:**
```json
{
  "id": "uuid",
  "phone": "+525512345678",
  "name": "Juan Pérez",
  "status": "NEW",
  "createdAt": "2026-02-17T..."
}
```

### GET /api/leads

Listar leads con paginación.

```bash
curl "https://revenio-api.up.railway.app/api/leads?limit=20&offset=0"
```

**Query params:**
- `limit` — Máximo de resultados (default: 50)
- `offset` — Offset para paginación
- `status` — Filtrar por status

---

## Calls

### POST /call/test

Disparar una llamada de prueba.

```bash
curl -X POST https://revenio-api.up.railway.app/call/test \
  -H "Content-Type: application/json" \
  -d '{"lead_id": "uuid", "to_number": "+525512345678"}'
```

**Body:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| lead_id | uuid | ✅ | ID del lead |
| to_number | string | ✅ | Número destino |

**Response:**
```json
{
  "ok": true,
  "attempt_id": "uuid",
  "vapi": {
    "id": "vapi-call-id",
    "status": "queued"
  }
}
```

### POST /call/test/direct

Llamada directa sin lead previo.

```bash
curl -X POST https://revenio-api.up.railway.app/call/test/direct \
  -H "Content-Type: application/json" \
  -d '{"phone": "+525512345678", "name": "Test User"}'
```

---

## Webhooks

### POST /webhooks/vapi/result

Recibe resultado de llamada VAPI.

**Payload (de VAPI):**
```json
{
  "id": "vapi-call-id",
  "status": "ended",
  "endedReason": "assistant-forwarded-call",
  "transcript": "...",
  "recordingUrl": "https://..."
}
```

### POST /webhooks/twilio/status

Recibe status de llamada Twilio.

**Payload (de Twilio):**
```json
{
  "CallSid": "...",
  "CallStatus": "completed",
  "CallDuration": "45"
}
```

---

## Errores

| Código | Descripción |
|--------|-------------|
| 400 | Parámetros inválidos |
| 404 | Lead no encontrado |
| 500 | Error interno |
| 502 | Error de VAPI/Twilio |
