# Plan: Nombre Dinámico + Deploy Droplet <OPERADOR_INTERNO> (v3)

**Objetivo:** Nombre dinámico en llamadas, funcionando en droplet de <OPERADOR_INTERNO> sin depender de <USUARIO_INTERNO>.

---

## Mensajes Finales

**CON nombre:**
> "Hola, ¿hablo con {{name}}? Soy <OPERADOR_INTERNO> de <CLIENTE_DEMO>, le llamo porque nos contactó por uno de nuestros desarrollos. ¿Me permite transferirle con uno de nuestros asesores?"

**SIN nombre:**
> "Hola, buenas tardes. Soy <OPERADOR_INTERNO> de <CLIENTE_DEMO>, le llamo porque nos contactó por uno de nuestros desarrollos. Uno de nuestros asesores lo atenderá de manera personal, por favor déme unos segundos que le estoy transfiriendo su llamada."

---

## Microbloques

| ID | Nombre | Tiempo | Tipo |
|----|--------|--------|------|
| MB-01 | Configurar {{name}} en VAPI Dashboard | 10 min | Config |
| MB-02 | Crear endpoint /call/vapi en droplet | 20 min | Backend |
| MB-03 | Sanitizar nombre + lógica de mensajes | 15 min | Backend |
| MB-04 | Configurar env vars en droplet | 10 min | Infra |
| MB-05 | Deploy y verificar health | 10 min | Infra |
| MB-06 | Test E2E con llamada real | 15 min | QA |

**Total estimado:** 80 min

---

## Fichas Técnicas

### MB-01: Configurar {{name}} en VAPI Dashboard

| Aspecto | Valor |
|---------|-------|
| **Objetivo** | Agregar variable `{{name}}` al firstMessage del assistant |
| **Herramienta** | VAPI API (PATCH /assistant/{id}) |
| **Assistant ID** | `<VAPI_ASSISTANT_ID_ES>` |
| **firstMessage nuevo** | `"Hola, ¿hablo con {{name}}? Soy <OPERADOR_INTERNO> de <CLIENTE_DEMO>, le llamo porque nos contactó por uno de nuestros desarrollos. ¿Me permite transferirle con uno de nuestros asesores?"` |
| **Método** | curl PATCH con Authorization Bearer |

**Comando:**
```bash
curl -X PATCH "https://api.vapi.ai/assistant/<VAPI_ASSISTANT_ID_ES>" \
  -H "Authorization: Bearer <VAPI_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "firstMessage": "Hola, ¿hablo con {{name}}? Soy <OPERADOR_INTERNO> de <CLIENTE_DEMO>, le llamo porque nos contactó por uno de nuestros desarrollos. ¿Me permite transferirle con uno de nuestros asesores?"
  }'
```

**Verificación:**
```bash
curl -s "https://api.vapi.ai/assistant/<VAPI_ASSISTANT_ID_ES>" \
  -H "Authorization: Bearer <VAPI_API_KEY>" \
  | jq '.firstMessage'
# Debe contener {{name}}
```

---

### MB-02: Crear endpoint /call/vapi en droplet

| Aspecto | Valor |
|---------|-------|
| **Objetivo** | Endpoint standalone para iniciar llamadas VAPI |
| **Servidor destino** | <DROPLET_IP> (DEV droplet <OPERADOR_INTERNO>) |
| **Puerto** | 3001 (nuevo servicio) o integrar en existente |
| **Stack** | Node.js + Express (mínimo) |
| **Dependencias** | dotenv, express |

**Estructura del servicio:**
```
/opt/revenio-caller/
├── index.js          # Servidor Express
├── package.json
├── .env              # VAPI credentials
└── ecosystem.config.js  # PM2 config
```

**Código index.js:**
```javascript
require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;

const FIRST_MESSAGE_WITH_NAME = "Hola, ¿hablo con {{name}}? Soy <OPERADOR_INTERNO> de <CLIENTE_DEMO>, le llamo porque nos contactó por uno de nuestros desarrollos. ¿Me permite transferirle con uno de nuestros asesores?";

const FIRST_MESSAGE_NO_NAME = "Hola, buenas tardes. Soy <OPERADOR_INTERNO> de <CLIENTE_DEMO>, le llamo porque nos contactó por uno de nuestros desarrollos. Uno de nuestros asesores lo atenderá de manera personal, por favor déme unos segundos que le estoy transfiriendo su llamada.";

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'revenio-caller' });
});

app.post('/call/vapi', async (req, res) => {
  const { to_number, lead_name } = req.body;
  
  if (!to_number) {
    return res.status(400).json({ error: 'to_number required' });
  }

  // Sanitizar nombre
  const safeName = lead_name?.trim() || null;

  // Construir payload
  const payload = {
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    assistantId: VAPI_ASSISTANT_ID,
    customer: { number: to_number },
  };

  // Lógica de mensajes
  if (safeName) {
    payload.assistantOverrides = {
      variableValues: { name: safeName }
    };
  } else {
    payload.assistantOverrides = {
      firstMessage: FIRST_MESSAGE_NO_NAME
    };
  }

  try {
    const resp = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VAPI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();

    if (!resp.ok) {
      return res.status(502).json({ error: 'vapi_error', status: resp.status, data });
    }

    return res.json({ ok: true, call_id: data.id, payload_sent: payload });
  } catch (err) {
    return res.status(500).json({ error: 'network_error', message: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`revenio-caller on :${PORT}`));
```

**Verificación:**
```bash
curl http://<DROPLET_IP>:3001/health
# {"ok":true,"service":"revenio-caller"}
```

---

### MB-03: Sanitizar nombre + lógica de mensajes

| Aspecto | Valor |
|---------|-------|
| **Objetivo** | Manejar edge cases de nombre |
| **Integrado en** | MB-02 (ya incluido en código) |

**Edge cases cubiertos:**
| Input | safeName | Mensaje usado |
|-------|----------|---------------|
| `"<NOMBRE_DE_EJEMPLO>"` | `"<NOMBRE_DE_EJEMPLO>"` | CON nombre |
| `"  María  "` | `"María"` | CON nombre |
| `""` | `null` | SIN nombre |
| `"   "` | `null` | SIN nombre |
| `null` | `null` | SIN nombre |
| `undefined` | `null` | SIN nombre |

---

### MB-04: Configurar env vars en droplet

| Aspecto | Valor |
|---------|-------|
| **Objetivo** | Credentials VAPI en el droplet |
| **Archivo** | `/opt/revenio-caller/.env` |

**Contenido .env:**
```
VAPI_API_KEY=<VAPI_API_KEY>
VAPI_PHONE_NUMBER_ID=<VAPI_PHONE_NUMBER_ID>
VAPI_ASSISTANT_ID=<VAPI_ASSISTANT_ID_ES>
PORT=3001
```

**Verificación:**
```bash
ssh root@<DROPLET_IP> "cat /opt/revenio-caller/.env | grep -c VAPI"
# Debe ser 3
```

---

### MB-05: Deploy y verificar health

| Aspecto | Valor |
|---------|-------|
| **Objetivo** | Servicio corriendo con PM2 |
| **Comandos** | npm install, pm2 start |

**Secuencia:**
```bash
ssh root@<DROPLET_IP> << 'EOF'
cd /opt/revenio-caller
npm install
pm2 start index.js --name revenio-caller
pm2 save
EOF
```

**Verificación:**
```bash
curl http://<DROPLET_IP>:3001/health
```

---

### MB-06: Test E2E con llamada real

| Aspecto | Valor |
|---------|-------|
| **Objetivo** | Confirmar nombre dinámico funciona |

**Test 1: Con nombre**
```bash
curl -X POST http://<DROPLET_IP>:3001/call/vapi \
  -H "Content-Type: application/json" \
  -d '{"to_number": "<LEGACY_FALLBACK_PHONE>", "lead_name": "<OPERADOR_INTERNO>"}'
```
**Esperado:** Dice "Hola, ¿hablo con <OPERADOR_INTERNO>?"

**Test 2: Sin nombre**
```bash
curl -X POST http://<DROPLET_IP>:3001/call/vapi \
  -H "Content-Type: application/json" \
  -d '{"to_number": "<LEGACY_FALLBACK_PHONE>"}'
```
**Esperado:** Dice "Hola, buenas tardes... Uno de nuestros asesores lo atenderá..."

---

## Dependencias

```
MB-01 (VAPI config) ───┐
                       ├──► MB-06 (Test E2E)
MB-02 (código) ────────┤
       │               │
       └─► MB-03 ──────┤
                       │
MB-04 (env vars) ──────┤
       │               │
       └─► MB-05 ──────┘
```
