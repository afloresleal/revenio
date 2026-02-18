# API Reference

## POST /call/vapi (Production Endpoint)

Inicia una llamada VAPI con validación de horario y flujo dinámico.

### Restricción de Horario
- **Solo 7:00 AM - 10:00 PM CST**
- Fuera de horario retorna `400 outside_business_hours`

### Request Body
```json
{
  "to_number": "+521234567890",    // required
  "lead_name": "Marina",           // optional - determina flujo
  "lead_id": "uuid",               // optional - usa lead existente
  "lead_source": "facebook"        // optional - default "vapi-call"
}
```

### Flujos

| Campo | Comportamiento |
|-------|----------------|
| `lead_name` presente | `firstMessage: "Hola, ¿hablo con {{name}}?"` (VAPI default) |
| `lead_name` vacío/null | Saludo dinámico por hora + override completo |

### Saludos Dinámicos (sin nombre)
- **7am-12pm:** "Hola, buenos días."
- **12pm-6pm:** "Hola, buenas tardes."
- **6pm-10pm:** "Hola, linda noche."

### Response (200)
```json
{
  "ok": true,
  "attempt_id": "uuid",
  "lead_id": "uuid",
  "flow": "with_name" | "without_name",
  "greeting": "Hola, ¿hablo con Marina?" | "Hola, buenos días.",
  "vapi": { /* VAPI response */ }
}
```

### Error (400) - Fuera de horario
```json
{
  "error": "outside_business_hours",
  "message": "Llamadas solo permitidas de 7:00 AM a 10:00 PM CST",
  "current_hour_cst": 23
}
```

--- — Revenio

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
