# VAPI Config Producción — Revenio Voice Agent

> **Última actualización:** 2026-02-16
> **Optimizado por:** Marina (pruebas en #pruebas-llamadas)
> **North Star:** Maximizar % de llamadas transferidas exitosamente en <30s

---

## 1. Identificadores Críticos

| Recurso | Variable de Entorno | Descripción |
|---------|---------------------|-------------|
| API Key | `VAPI_API_KEY` | Key privada (server-side). Nunca exponer en frontend. |
| Assistant ID | `VAPI_ASSISTANT_ID` | ID del assistant configurado abajo |
| Phone Number ID | `VAPI_PHONE_NUMBER_ID` | Número de salida (Twilio/Vapi) |

---

## 2. Assistant Config (JSON)

```json
{
  "name": "Marina - Casalba Assistant",
  "model": {
    "provider": "openai",
    "model": "gpt-4o",
    "temperature": 0.3,
    "messages": [
      {
        "role": "system",
        "content": "Eres Marina, asistente virtual de Casalba, una desarrolladora inmobiliaria en Los Cabos.\n\nFLUJO OBLIGATORIO:\n1. Saluda y espera confirmación de identidad\n2. Confirma datos: \"Veo que estás interesado en propiedades con presupuesto de {{presupuesto}} dólares, ¿es correcto?\"\n3. IMPORTANTE: \"¿es correcto?\" ES UNA PREGUNTA. Usa entonación de pregunta.\n4. Una vez confirmado, di EXACTAMENTE: \"Permíteme, no cuelgues, te comunico con un asesor.\"\n5. INMEDIATAMENTE después, ejecuta transferCall. NO digas NADA más.\n\nREGLAS:\n- NO repitas palabras consecutivas\n- NO improvises texto después del mensaje de transfer\n- Si te preguntan algo que no sabes, di: \"Esa pregunta es perfecta para el asesor, permíteme conectarte.\"\n- Habla en español mexicano natural\n- Sé breve y directa"
      }
    ],
    "tools": [
      {
        "type": "transferCall",
        "destinations": [
          {
            "type": "number",
            "number": "+525527326714",
            "message": "Qué tal {{name}}, habla Marina de Casalba, asistente virtual. Nos dejaste tus datos sobre propiedades en Los Cabos. Permíteme, no cuelgues, te comunico con un asesor."
          }
        ],
        "function": {
          "name": "transferCall",
          "description": "Transfiere la llamada al asesor de ventas. Usar después de confirmar datos del lead."
        }
      }
    ]
  },
  "voice": {
    "provider": "deepgram",
    "voiceId": "luna",
    "speed": 1.10
  },
  "firstMessage": "... Hola {{name}}, ¿cómo estás?",
  "transcriber": {
    "provider": "deepgram",
    "language": "es",
    "model": "nova-2"
  },
  "serverUrl": "https://revenioapi-production.up.railway.app/webhooks/vapi/result",
  "serverUrlSecret": null,
  "endCallFunctionEnabled": false,
  "recordingEnabled": true,
  "silenceTimeoutSeconds": 30,
  "maxDurationSeconds": 300,
  "backgroundSound": "office"
}
```

---

## 3. Transcription & VAD Settings

```json
{
  "transcriber": {
    "provider": "deepgram",
    "language": "es",
    "model": "nova-2",
    "smartFormat": true
  },
  "voicemailDetection": {
    "enabled": false
  },
  "startSpeakingPlan": {
    "waitSeconds": 0.3,
    "smartEndpointingEnabled": true,
    "transcriptionEndpointingPlan": {
      "onPunctuationSeconds": 0.1,
      "onNoPunctuationSeconds": 1.2,
      "onNumberSeconds": 0.5
    }
  },
  "stopSpeakingPlan": {
    "numWords": 2,
    "voiceSeconds": 0.2,
    "backoffSeconds": 1.0
  }
}
```

**Por qué estos valores:**
- `endpointingMs: 400` → Evita cortar al usuario mid-frase (español tiene pausas naturales más largas)
- `smartFormat: true` → Mejora formato de números en transcript
- `speed: 1.10` → Reduce "aire" entre frases sin sonar acelerado
- `"..."` en firstMessage → Micro-silencio para evitar ruido de conexión

---

## 4. Variables de Llamada (Runtime)

Al disparar cada llamada via API, pasar:

```json
{
  "phoneNumberId": "{{VAPI_PHONE_NUMBER_ID}}",
  "assistantId": "{{VAPI_ASSISTANT_ID}}",
  "customer": {
    "number": "+521234567890"
  },
  "assistantOverrides": {
    "variableValues": {
      "name": "Leonardo",
      "presupuesto": "doscientos a trescientos cincuenta mil"
    },
    "metadata": {
      "lead_id": "uuid-del-lead",
      "attempt_id": "uuid-del-attempt"
    }
  }
}
```

**IMPORTANTE:**
- `name` debe ser el nombre completo (no apodos)
- `presupuesto` debe estar EN LETRAS, no números. GPT convierte "200000" a "doscientos mil" inconsistentemente.
- `metadata.attempt_id` permite correlacionar webhook con DB

---

## 5. Webhook Config

**URL:** `https://revenioapi-production.up.railway.app/webhooks/vapi/result`

**Server Messages habilitados:**
- ✅ `end-of-call-report` (obligatorio)
- ✅ `status-update` (recomendado)
- ❌ `transcript` (no necesario, viene en end-of-call)

**Payload que llega:**
```json
{
  "message": {
    "type": "end-of-call-report",
    "call": {
      "id": "vapi-call-id",
      "status": "ended",
      "endedReason": "assistant-forward-call",
      "transcript": "...",
      "recordingUrl": "https://..."
    }
  }
}
```

---

## 6. Transfer Tool — Config Detallada

```json
{
  "type": "transferCall",
  "destinations": [
    {
      "type": "number",
      "number": "+525527326714",
      "message": "Qué tal {{name}}, habla Marina de Casalba, asistente virtual. Nos dejaste tus datos sobre propiedades en Los Cabos. Permíteme, no cuelgues, te comunico con un asesor.",
      "description": "Asesor de ventas Casalba"
    }
  ],
  "function": {
    "name": "transferCall",
    "description": "Transfiere la llamada al asesor de ventas. Usar SOLO después de confirmar datos.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  }
}
```

**Por qué el mensaje está en el tool y no en el prompt:**
- El LLM puede "olvidar" decir el mensaje completo
- Con `message` en el tool, VAPI lo dice automáticamente antes de transferir
- Garantiza consistencia 100%

---

## 7. Lecciones Aprendidas (Pruebas 06-13 Feb)

| Problema | Causa | Solución Aplicada |
|----------|-------|-------------------|
| LLM saltaba presentación | gpt-4o-mini no sigue instrucciones complejas | Cambiar a gpt-4o |
| Texto basura post-transfer | LLM alucinaba después de decir "te comunico" | Mover mensaje al tool |
| "Shao" en vez de nombre | Ruido de conexión inicial | Agregar "..." al inicio de firstMessage |
| Números mal dichos | GPT convierte a dígitos | Pasar presupuesto EN LETRAS |
| Silencio durante transfer | Sin música de espera | Agregar `backgroundSound: "office"` |
| Llamada colgaba al transferir | Número USA no puede transferir a MX | Pendiente: usar número Twilio MX |

---

## 8. Checklist Pre-Producción

- [ ] Verificar que `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID` estén en Railway
- [ ] Confirmar que webhook URL es accesible (`curl -X POST https://.../webhooks/vapi/result`)
- [ ] Probar llamada con número verificado
- [ ] Confirmar que transcript aparece en `/lab/history`
- [ ] Verificar que el número de destino del transfer (+525527326714) está activo
- [ ] Si usas Twilio Trial: verificar número destino en Twilio Console

---

## 9. Troubleshooting Rápido

| Síntoma | Causa Probable | Acción |
|---------|----------------|--------|
| "missing_vapi_config" | Variables de entorno faltantes | Verificar en Railway |
| Llamada no suena | Número destino no verificado (Twilio Trial) | Verificar o upgrade cuenta |
| Sin transcript en historial | Webhook no llegó | Usar botón "Sincronizar" en Lab |
| Transfer cuelga | Número origen no soporta internacional | Usar número Twilio MX |
| Variables aparecen literales | `variableValues` no pasado | Verificar payload de llamada |

---

## 10. Contacto y Escalación

- **Config del Assistant:** Marina
- **Backend/API:** Ale
- **Campaña/Leads:** Leo
- **Canal de pruebas:** #pruebas-llamadas
