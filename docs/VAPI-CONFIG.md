# VAPI Config Producción — Revenio Voice Agent

> **Última actualización:** 2026-02-24
> **Optimizado por:** Julia + Marina (canal #agent-voice-opt)
> **North Star:** Transfer inmediato sin confirmaciones (<2s latencia)

---

## 1. Identificadores Críticos

### Agentes Disponibles

| Agente | ID | Idioma | Voz | Personalidad |
|--------|-----|--------|-----|--------------|
| **1-ES-F** (Marina) | `675d2cb2-7047-4949-8735-bedb29351991` | Español | ElevenLabs `m7yTemJqdIqrcNleANfX` | Profesional mexicana |
| **2-EN-F** (Rachel) | `5ac0c5dd-2e79-4d29-b76a-add2ff1b93b7` | English | ElevenLabs `21m00Tcm4TlvDq8ikWAM` | Professional, warm |
| **3-EN-F** (Bella) | `6b9e8a41-43f5-4439-b14c-6c842fee7d66` | English | ElevenLabs `EXAVITQu4vr4xnSDxMaL` | Friendly, upbeat |

### Infraestructura Compartida

| Recurso | ID |
|---------|-----|
| Phone Number ID | `56a80999-3361-4501-ae74-f23beaea1c41` |
| Twilio Number | `+13502169412` |
| Número destino transfer | `+525527326714` |

---

## 2. Assistant Config Actual (2026-02-18)

### System Prompt
```
Eres Marina de Casalba. Cuando la persona responda (hola, sí, bueno, cualquier respuesta), ejecuta transferCall inmediatamente. No pidas confirmación múltiples veces. IMPORTANTE: Cuando ejecutes transferCall, NO generes ningún mensaje de despedida ni de presentación adicional - VAPI ya tiene un mensaje de transfer configurado.
```

### First Message
```
Hola, ¿hablo con Valeria?
```

### Model Config
```json
{
  "provider": "openai",
  "model": "gpt-4o-mini"
}
```

### Transfer Tool
```json
{
  "type": "transferCall",
  "destinations": [{
    "type": "number",
    "number": "+525527326714",
    "message": "Qué tal, habla Marina de Casalba, asistente virtual. Nos dejaste tus datos sobre propiedades en Los Cabos. Permíteme, no cuelgues, te comunico con un asesor."
  }]
}
```

---

## 3. Voice Config (ElevenLabs Turbo)

```json
{
  "provider": "11labs",
  "model": "eleven_turbo_v2_5",
  "voiceId": "m7yTemJqdIqrcNleANfX",
  "speed": 1.15,
  "stability": 0.5,
  "similarityBoost": 0.75
}
```

**Por qué eleven_turbo_v2_5:**
- Menor latencia que `eleven_multilingual_v2`
- Trade-off: acento ligeramente diferente en español

---

## 4. Transcriber Config (Deepgram Nova-3)

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

## 5. Speaking Plans (Optimizados para baja latencia)

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

## 6. Métricas de Latencia (Benchmark 2026-02-17)

| Llamada | Turn Total | Transcriber | Endpoint |
|---------|------------|-------------|----------|
| Antes de optimización | 2798ms | 395ms | 50ms |
| Después | 1398-1568ms | 191-553ms | 21-301ms |

**Mejora: ~50% reducción en latencia total**

---

## 7. Lecciones Aprendidas (Feb 2026)

| Problema | Causa | Solución |
|----------|-------|----------|
| Mensaje duplicado al transferir | LLM genera despedida + VAPI agrega message | Agregar instrucción "NO generes mensaje" al prompt |
| Latencia 2.8s | TTS lento + tiempos altos | eleven_turbo + waitSeconds bajos |
| Desync Twilio↔VAPI | Assistant se desasocia del phone | Re-attach via PATCH /phone-number/{id} |
| Llamadas se cortan sin audio | Desync silencioso | Health check cada 5 min (propuesto) |

---

## 8. Troubleshooting

| Síntoma | Causa | Acción |
|---------|-------|--------|
| Llamada se corta al conectar | Desync Twilio↔VAPI | Re-attach assistant (ver docs/bug-twilio-vapi-desync.md) |
| AI no responde | Desync o credenciales | Verificar VAPI dashboard |
| Mensaje duplicado | Prompt no indica silencio | Ya corregido en prompt actual |
| Transfer no funciona | Tool no configurado | Verificar destinations en tool |

---

## 9. Historial de Cambios

| Fecha | Cambio | Autor |
|-------|--------|-------|
| 2026-02-18 | Agregado "NO generes mensaje" al prompt | Julia |
| 2026-02-17 | Optimización latencia (turbo + tiempos bajos) | Julia |
| 2026-02-17 | Documentado bug desync | Julia |
| 2026-02-16 | Configuración inicial | Marina + Ale |
