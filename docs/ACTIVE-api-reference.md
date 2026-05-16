# API Reference

> Contexto operativo actual de transfer/failover: ver [CALL-TRANSFER-HANDOFF-2026-04-08.md](./CALL-TRANSFER-HANDOFF-2026-04-08.md)

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
  "lead_source": "facebook",       // optional - default "vapi-call"
  "round_robin_enabled": true,     // optional
  "round_robin_agents": [          // optional - max 5
    {
      "name": "Ana",               // optional
      "transfer_number": "+525512345678" // required
    }
  ]
}
```

### Round Robin (hasta 5 agentes)

> Nota 2026-05-06: este endpoint directo puede seguir usando agentes en request o ENV para pruebas técnicas. Para campañas GHL nuevas, la fuente de verdad de vendedores y fallback es Admin/BD.
- Activar con `round_robin_enabled: true`.
- Definir agentes humanos en request con `round_robin_agents` (1..5).
- Si no mandas `round_robin_agents`, el API puede usar ENV:
  - `HUMAN_AGENT_NUMBERS` (coma-separado)
  - `HUMAN_AGENT_NAMES` (coma-separado, opcional)
- Cuando está activo, el API rota por índice y responde `selected_agent`.
- `transfer_number` del request es requerido: se usa como destino directo sin RR y como fallback final si se agotan los agentes del pool.
- No hay número de fallback por ENV ni hardcodeado.

### Flujos

| Campo | Comportamiento |
|-------|----------------|
| `lead_name` presente | Se envía `variableValues.name` para interpolación en VAPI |
| `lead_name` vacío/null | No se inyecta prompt/mensaje; VAPI usa su configuración del assistant |

### Fuente de verdad del prompt (VAPI)
- El backend **no** debe inyectar `firstMessage`, `model` ni `tools` para asistentes VAPI.
- `assistantOverrides` se limita a `metadata` y, cuando aplica, `variableValues`.
- Esto evita comportamientos inconsistentes entre deploys y mantiene el script 100% en VAPI dashboard.

### Response (200)
```json
{
  "ok": true,
  "attempt_id": "uuid",
  "lead_id": "uuid",
  "flow": "with_name" | "without_name",
  "selected_agent": {
    "assistant_id": "assistant-id", // agente VAPI fijo
    "human_agent_name": "Ana",
    "transfer_number": "+52...",
    "round_robin_enabled": true,
    "round_robin_index": 0,
    "round_robin_pool_size": 3
  },
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

### POST /webhooks/twilio/transfer-status

Callback de `<Dial action=...>` / `statusCallback` para transfer leg.

Notas críticas:
- Cuando Twilio invoca este callback como `Dial action`, el endpoint debe responder TwiML válido.
- Responder texto plano/JSON puede causar el audio: `"we are sorry an application error has occurred, goodbye"`.
- `transfer_success` no debe inferirse solo por `assistant-forwarded-call`; debe requerir evidencia de conexión humana.
- RR robusto:
  - si falta `DialCallStatus`, backend aplica fallback desde `status-update`.
  - `status-update: ended` también puede disparar failover.
  - se aplica protección anti-duplicado para evitar doble escalamiento por eventos fuera de orden.

---

## Errores

| Código | Descripción |
|--------|-------------|
| 400 | Parámetros inválidos |
| 404 | Lead no encontrado |
| 500 | Error interno |
| 502 | Error de VAPI/Twilio |
