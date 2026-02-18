# Resumen para Ale — Integración VAPI

> **TL;DR:** El voice agent está optimizado y funcionando. Tu trabajo es asegurar que el backend pase las variables correctas y maneje los webhooks.

---

## Lo que ya está hecho (Marina lo optimizó)

✅ Assistant configurado en VAPI Dashboard (gpt-4o, voice settings, prompt)  
✅ Tool de transfer con mensaje automático  
✅ VAD/transcription optimizado para español  
✅ Webhook funcionando en `/webhooks/vapi/result`  
✅ Lab UI para monitoreo  

---

## Lo que necesitas del código actual

### 1. Endpoint que dispara llamadas
**Archivo:** `apps/api/src/server.ts` → `POST /call/test/direct`

```typescript
// Línea ~280 - Payload que se envía a VAPI
const payload = {
  phoneNumberId: resolvedVapiPhoneNumberId,
  assistantId: resolvedVapiAssistantId,
  customer: { number: to_number },
  metadata: { lead_id: lead.id, attempt_id: attempt.id },
};
```

**⚠️ FALTA:** Agregar `assistantOverrides.variableValues` con nombre y presupuesto.

### 2. Webhook que recibe resultados
**Archivo:** `apps/api/src/server.ts` → `POST /webhooks/vapi/result`

Ya funciona. Guarda en `Event` y actualiza `CallAttempt.resultJson`.

### 3. Variables de entorno requeridas
```
VAPI_API_KEY=sk_...
VAPI_ASSISTANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  
VAPI_PHONE_NUMBER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
DATABASE_URL=postgresql://...
```

---

## Cambio que debes hacer

### Pasar variables del lead a VAPI

**Antes (actual):**
```typescript
const payload = {
  phoneNumberId: ...,
  assistantId: ...,
  customer: { number: to_number },
  metadata: { lead_id: lead.id, attempt_id: attempt.id },
};
```

**Después (requerido):**
```typescript
const payload = {
  phoneNumberId: ...,
  assistantId: ...,
  customer: { number: to_number },
  assistantOverrides: {
    variableValues: {
      name: lead.name ?? "estimado cliente",
      presupuesto: lead.presupuesto ?? "entre doscientos y trescientos cincuenta mil",
    },
    metadata: { 
      lead_id: lead.id, 
      attempt_id: attempt.id 
    },
  },
};
```

**Por qué:** El assistant usa `{{name}}` y `{{presupuesto}}` en el prompt. Si no los pasas, dice basura.

---

## Tareas técnicas opcionales (nice to have)

| Tarea | Impacto | Tiempo |
|-------|---------|--------|
| Agregar campo `presupuesto` al modelo Lead | Permite personalizar llamada | 30 min |
| Endpoint `/health/vapi` que valide config | Detectar config rota | 15 min |
| Log estructurado de `transfer_initiated` | Métricas de KPI | 20 min |
| Retry en `vapi_network_error` | Menos fallos por latencia | 30 min |

---

## Documentación completa

Ver `docs/vapi-config-prod.md` para:
- JSON completo del assistant
- Troubleshooting
- Lecciones aprendidas
- Checklist pre-producción

---

## Si algo falla

1. Revisar Lab UI → `/` → Historial
2. Usar "Sincronizar transcript" si no llegó webhook
3. Revisar logs de Railway
4. Preguntar a Marina — ella tiene contexto de todas las pruebas

---

**Pregunta clave para Marina:** ¿De dónde sacamos el presupuesto del lead? ¿Viene del CRM, del formulario de campaña, o se asigna fijo?
