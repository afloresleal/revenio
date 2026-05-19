# VAPI Config Producción — Revenio Voice Agent

> Nota de handoff técnico (2026-04-08): ver [CALL-TRANSFER-HANDOFF-2026-04-08.md](./CALL-TRANSFER-HANDOFF-2026-04-08.md) para reglas de no-regresión del flujo Vapi+Twilio.
> Nota de staging GHL (2026-05-03): ver [GHL-DEMO-HANDOFF-2026-05-03.md](./GHL-DEMO-HANDOFF-2026-05-03.md) para la configuración validada de Assistant EN 1 + GoHighLevel.
> Nota Admin (2026-05-06): para demos nuevos con GHL, los `Vapi Assistant ID` y `Vapi Phone Number ID` por campaña se configuran en Admin/BD, no con variables `GHL_CAMPAIGN_*` en Railway.

> **Última actualización:** 2026-05-03
> **Optimizado por:** <CLAWDBOT_INTERNO> + <OPERADOR_INTERNO> (canal #revenio-mvp-voice-agent)
> **Brand:** <CLIENTE_DEMO> (<MERCADO_DEMO>)
> **North Star:** Transfer exitoso con confirmación inteligente

---

## 1. Identificadores Críticos

### Agentes Disponibles

| Agente | ID | Idioma | Nombre | Comportamiento |
|--------|-----|--------|--------|----------------|
| **1-ES-F** | `<VAPI_ASSISTANT_ID_ES>` | Español | <OPERADOR_INTERNO> | Transfer inmediato |
| **2-EN-F** | `<VAPI_ASSISTANT_ID_EN_1>` | English | **Assistant EN 1** | Transfer inmediato (sin confirmación) |
| **3-EN-F** | `<VAPI_ASSISTANT_ID_EN_2>` | English | **Assistant EN 2** | Con confirmación antes de transfer |

### Infraestructura Compartida

| Recurso | ID |
|---------|-----|
| Phone Number ID | `<VAPI_PHONE_NUMBER_ID>` |
| Twilio Number | `<TWILIO_PHONE_NUMBER>` |
| Número destino transfer | Dinámico desde Revenio / GHL round robin |

### Webhook por ambiente

| Ambiente | Vapi Assistant Server URL |
|----------|---------------------------|
| Staging | `https://<API_STAGING_HOST>/webhooks/vapi/events` |
| Production | `https://<API_PRODUCTION_HOST>/webhooks/vapi/events` |

Regla operativa: si la llamada se crea desde staging, el assistant usado en Vapi debe apuntar al webhook staging. Si apunta a production, los eventos de transferencia se procesan en el backend equivocado y Vapi puede usar fallback/config vieja.

### Checklist Vapi para pruebas GHL staging

- Assistant correcto: `Assistant EN 1 - EN - <CLIENTE_DEMO>` (`<VAPI_ASSISTANT_ID_EN_1>`).
- Railway staging: `VAPI_ASSISTANT_ID=<VAPI_ASSISTANT_ID_EN_1>`.
- Para multi-campaña nueva, usar Admin para guardar el `Vapi Assistant ID` por campaña. Las variables `GHL_CAMPAIGN_*_VAPI_ASSISTANT_ID` quedaron como referencia histórica del demo anterior.
- Server URL: `https://<API_STAGING_HOST>/webhooks/vapi/events`.
- Timeout recomendado: `10` a `30` segundos.
- Server Messages:
  - Activar: `transfer-update`, `transfer-destination-request`, `speech-update`, `tool-calls`, `end-of-call-report`.
  - Desactivar: `phone-call-control`.
- No dejar `Forwarding Phone Number` / fallback advisor hardcodeado para el flujo GHL.
- No asignar un segundo tool nativo `Transfer Call` con destino hardcodeado. Revenio manda el `transferCall` y el asesor dinamicamente en `assistantOverrides`.

---

## 2. First Messages

### Assistant EN 1 (2-EN-F) — Transfer Inmediato
```
Hi {name} — we just received the request you submitted a moment ago about <MERCADO_DEMO> properties. This is Assistant EN 1, a virtual assistant with <CLIENTE_DEMO>. Let me connect you with one of our property specialists right now. One moment while I connect you.
```

### Assistant EN 2 (3-EN-F) — Con Confirmación
```
Hi {name} — we just received your request for information about <MERCADO_DEMO> properties. This is Assistant EN 2, a virtual assistant with <CLIENTE_DEMO>. Did you just submit that request a moment ago?
```

### <OPERADOR_INTERNO> (1-ES-F) — Español
```
Hola, ¿hablo con {name}?
```

---

## 3. System Prompts

### Assistant EN 1 (Transfer Inmediato)
```
You are Assistant EN 1 from <CLIENTE_DEMO>. After delivering the first message, execute transferCall immediately. Do not wait for a response. Do not generate any additional message after initiating the transfer.
```

### Assistant EN 2 (Con Confirmación + Edge Cases)
```
You are Assistant EN 2 from <CLIENTE_DEMO>. After delivering the first message, wait for the customer's response.

AFFIRMATIVE RESPONSES (execute transfer):
- yes, yeah, sure, correct, that's right, yep, uh-huh, speaking, I did, that's me, absolutely, right, yup, indeed, of course, certainly
- Say: "Perfect. I'll connect you with a property specialist right now."
- Then execute transferCall immediately. Do not generate any message after initiating transfer.

NEGATIVE RESPONSES (end call politely):
- no, nope, not me, wrong number, I didn't, negative, not at all
- Say: "I apologize for the confusion. Have a great day!"
- End the call.

NO RESPONSE (timeout ~5 seconds):
- Say: "I'm sorry, I didn't catch that. Did you just submit a request about properties in <MERCADO_DEMO>?"
- Wait for response. If still no response after second attempt, say: "No problem, feel free to reach out when you're ready. Goodbye!" and end call.

UNCLEAR/AMBIGUOUS RESPONSES:
- what, huh, sorry, pardon, can you repeat
- Say: "Of course! I'm Assistant EN 2 from <CLIENTE_DEMO>. We received your request about <MERCADO_DEMO> properties. Would you like me to connect you with a specialist?"
- Then follow affirmative/negative flow above.
```

### <OPERADOR_INTERNO> (Español)
```
Eres <OPERADOR_INTERNO> de <CLIENTE_DEMO>. Cuando el usuario responda, ejecuta transferCall inmediatamente. No digas nada, solo ejecuta el tool.
```

---

## 4. Transfer Messages

### English (Assistant EN 1/Assistant EN 2)
```
This is a virtual assistant with <CLIENTE_DEMO>. We received your request about <MERCADO_DEMO> properties. Please hold while I connect you with a property specialist.
```

### Español (<OPERADOR_INTERNO>)
```
Habla <OPERADOR_INTERNO> de <CLIENTE_DEMO>, asistente virtual. Nos dejaste tus datos sobre propiedades en <MERCADO_DEMO>. Un asesor lo atenderá de manera personal, por favor deme unos segundos que le estoy transfiriendo su llamada.
```

---

## 5. Model Config
```json
{
  "provider": "openai",
  "model": "gpt-4o-mini"
}
```

---

## 6. Voice Config (ElevenLabs Turbo)

```json
{
  "provider": "11labs",
  "model": "eleven_turbo_v2_5",
  "voiceId": "<ELEVENLABS_VOICE_ID_ES>",
  "speed": 1.15,
  "stability": 0.5,
  "similarityBoost": 0.75
}
```

### Voice IDs por Agente
| Agente | Voice ID | Descripción |
|--------|----------|-------------|
| <OPERADOR_INTERNO> | `<ELEVENLABS_VOICE_ID_ES>` | ElevenLabs mujer ES |
| Assistant EN 1 (Voice EN 1) | `<ELEVENLABS_VOICE_ID_EN_1>` | ElevenLabs Voice EN 1 EN |
| Assistant EN 2 | `<ELEVENLABS_VOICE_ID_EN_2>` | ElevenLabs Assistant EN 2 EN |

---

## 7. Transcriber Config (Deepgram Nova-3)

```json
{
  "provider": "deepgram",
  "model": "nova-3",
  "language": "es",
  "smartFormat": true,
  "endpointing": 200
}
```

---

## 8. Speaking Plans (Optimizados para baja latencia)

### Start Speaking Plan
```json
{
  "waitSeconds": 0.1,
  "smartEndpointingEnabled": true,
  "transcriptionEndpointingPlan": {
    "onPunctuationSeconds": 0.02,
    "onNoPunctuationSeconds": 0.3,
    "onNumberSeconds": 0.2
  }
}
```

### Stop Speaking Plan
```json
{
  "numWords": 1,
  "voiceSeconds": 0.1,
  "backoffSeconds": 0.3
}
```

---

## 9. Edge Cases (Assistant EN 2)

| Escenario | Trigger | Respuesta |
|-----------|---------|-----------|
| **Afirmativo** | yes/yeah/sure/correct/yep/uh-huh | "Perfect. I'll connect you..." → transfer |
| **Negativo** | no/nope/wrong number | "I apologize..." → end call |
| **Sin respuesta** | ~5s silencio | Repetir pregunta 1 vez → end call |
| **Ambiguo** | what/huh/pardon | Clarificar → seguir flujo |

---

## 10. Transfer dinamico desde Revenio / GHL (2026-05-03)

Para el flujo GHL, Vapi no debe ser la fuente del numero del asesor. Revenio selecciona el asesor humano por round robin y crea la llamada con:

```json
{
  "assistantOverrides": {
    "model": {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "tools": [
        {
          "type": "transferCall",
          "destinations": [
            {
              "type": "number",
              "number": "+52...",
              "transferPlan": {
                "mode": "blind-transfer",
                "sipVerb": "dial"
              }
            }
          ]
        }
      ]
    },
    "variableValues": {
      "name": "...",
      "agent_name": "...",
      "transfer_number": "+52..."
    }
  }
}
```

La evidencia esperada en un log exitoso:

- `assistantId` corresponde al assistant configurado en Railway.
- `endedReason = assistant-forwarded-call`.
- `forwardedPhoneNumber` coincide con `assistantOverrides.variableValues.transfer_number`.
- `forwardedPhoneNumber` no debe ser el numero del lead ni un fallback viejo.

### Multi-campaña MVP

GHL debe enviar `campaignId` en Custom Data. Revenio lo usa para elegir el assistant Vapi:

| Campaign ID | Codigo Railway | Propiedad |
|-------------|----------------|-----------|
| `propiedad-demo-a-es` | `IB_ES` | <PROPIEDAD_DEMO_A> |
| `propiedad-demo-a-en` | `IB_EN` | <PROPIEDAD_DEMO_A> |
| `propiedad-demo-b-es` | `NO_ES` | <PROPIEDAD_DEMO_B> |
| `propiedad-demo-b-en` | `NO_EN` | <PROPIEDAD_DEMO_B> |

Variables por campaña:

```bash
GHL_CAMPAIGN_IB_ES_VAPI_ASSISTANT_ID=...
GHL_CAMPAIGN_IB_ES_VAPI_PHONE_NUMBER_ID=...
GHL_CAMPAIGN_IB_EN_VAPI_ASSISTANT_ID=...
GHL_CAMPAIGN_IB_EN_VAPI_PHONE_NUMBER_ID=...
GHL_CAMPAIGN_NO_ES_VAPI_ASSISTANT_ID=...
GHL_CAMPAIGN_NO_ES_VAPI_PHONE_NUMBER_ID=...
GHL_CAMPAIGN_NO_EN_VAPI_ASSISTANT_ID=...
GHL_CAMPAIGN_NO_EN_VAPI_PHONE_NUMBER_ID=...
```

Si una variable por campaña no existe, Revenio usa el fallback global `VAPI_ASSISTANT_ID` / `VAPI_PHONE_NUMBER_ID`.

## 11. Transfer Fallback Behavior historico (2026-03-05)

Cuando la transferencia al vendedor falla (no contesta, ocupado, timeout), el sistema NO corta la llamada abruptamente. En su lugar:

### Flujo de Fallback

```
Cliente contesta → Bot saluda → Transfer iniciado
                                      ↓
                    ┌─────────────────┴─────────────────┐
                    ↓                                   ↓
              Vendedor contesta                  Vendedor NO contesta
                    ↓                                   ↓
              Llamada continúa               Mensaje fallback automático
                                                        ↓
                                            "I apologize, our property
                                             specialists are currently
                                             assisting other clients.
                                             We have your contact info
                                             and someone will call you
                                             back within 30 minutes..."
                                                        ↓
                                                Llamada termina
                                                  gracefully
```

### Mensajes Configurados

| Tipo | Mensaje (English) |
|------|-------------------|
| `request-start` | "Please hold while I connect you with a property specialist." |
| `request-failed` | "I apologize, our property specialists are currently assisting other clients. We have your contact information and someone will call you back within the next 30 minutes. Thank you for your interest in <CLIENTE_DEMO>!" |

### Tool Structure historico (VAPI)

```json
{
  "type": "transferCall",
  "destinations": [{"type": "number", "number": "<LEGACY_FALLBACK_PHONE>"}],
  "messages": [
    {"type": "request-start", "content": "Please hold..."},
    {"type": "request-failed", "content": "I apologize..."}
  ]
}
```

Nota: esta estructura con destino fijo no debe usarse para el flujo GHL staging validado el 2026-05-03. Para GHL, el destino lo inyecta Revenio por llamada.

---

## 12. Historial de Cambios

| Fecha | Cambio | Autor |
|-------|--------|-------|
| 2026-05-03 | Documentado flujo GHL staging con Assistant EN 1, Server URL staging, `phone-call-control` off y transferencia dinamica desde Revenio | Codex + <USUARIO_INTERNO> |
| 2026-03-05 | Fix {{name}} interpolación + Transfer fallback behavior | <CLAWDBOT_INTERNO> |
| 2026-03-04 | Rebrand a <CLIENTE_DEMO>, nuevos scripts Assistant EN 1/Assistant EN 2 | <CLAWDBOT_INTERNO> |
| 2026-03-04 | Edge cases para Assistant EN 2 (negativo, timeout, ambiguo) | <CLAWDBOT_INTERNO> |
| 2026-02-18 | Agregado "NO generes mensaje" al prompt | <CLAWDBOT_INTERNO> |
| 2026-02-17 | Optimización latencia (turbo + tiempos bajos) | <CLAWDBOT_INTERNO> |
| 2026-02-17 | Documentado bug desync | <CLAWDBOT_INTERNO> |
| 2026-02-16 | Configuración inicial | <OPERADOR_INTERNO> + <USUARIO_INTERNO> |
