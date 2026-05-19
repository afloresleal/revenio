# Plan: Nombre Dinámico en firstMessage

## 🎯 Objetivo
Que <OPERADOR_INTERNO> (voice agent) diga el nombre real del lead en lugar de "<NOMBRE_DE_EJEMPLO>" hardcodeado.

---

## Microbloques

| ID | Nombre | Tiempo |
|----|--------|--------|
| MB-DN-01 | Actualizar payload VAPI con assistantOverrides | 15 min |
| MB-DN-02 | Manejar caso sin nombre (fallback graceful) | 10 min |
| MB-DN-03 | Test unitario del payload | 10 min |
| MB-DN-04 | Test E2E con llamada real | 15 min |

**Total estimado:** 50 min

---

## Fichas Técnicas

### MB-DN-01: Actualizar payload VAPI

| Aspecto | Estado Actual | Propuesta |
|---------|---------------|-----------|
| **Objetivo** | Payload no incluye firstMessage dinámico | Agregar `assistantOverrides.firstMessage` con `${lead.name}` |
| **Archivo** | `apps/api/src/server.ts` líneas 247-257, 305-315 | Mismo archivo |
| **Cambio** | `const payload = { phoneNumberId, assistantId, customer, metadata }` | Agregar `assistantOverrides: { firstMessage: \`Hola, ¿hablo con ${lead.name}?...\` }` |
| **Dependencias** | `lead.name` ya existe en DB | Ninguna nueva |
| **Prueba** | `curl POST /call/test/direct` con `lead_name: "<NOMBRE_DE_EJEMPLO>"` → verificar payload en logs |
| **Riesgo** | Bajo — es agregar un campo, no modificar lógica |

**Código propuesto (con feedback de Codex):**
```typescript
// Sanitizar nombre (Codex feedback: "" no es cubierto por ??)
const safeName = lead.name?.trim() || null;

const payload = {
  phoneNumberId: resolvedVapiPhoneNumberId,
  assistantId: resolvedVapiAssistantId,
  customer: { number: to_number },
  metadata: { lead_id: lead.id, attempt_id: attempt.id },
  assistantOverrides: {
    firstMessage: safeName
      ? `Hola, ¿hablo con ${safeName}? Soy <OPERADOR_INTERNO> de <CLIENTE_DEMO>, le llamo porque nos contactó por uno de nuestros desarrollos. ¿Me permite transferirle con uno de nuestros asesores?`
      : `Hola, buenas tardes. Soy <OPERADOR_INTERNO> de <CLIENTE_DEMO>, le llamo porque nos contactó por uno de nuestros desarrollos. ¿Me permite transferirle con uno de nuestros asesores?`
  }
};
```

**Alternativa escalable (variables dinámicas VAPI):**
En lugar de construir el string en backend, configurar en VAPI dashboard:
- `firstMessage`: `"Hola, ¿hablo con {{name}}? Soy <OPERADOR_INTERNO> de <CLIENTE_DEMO>..."`
- Payload: `assistantOverrides: { variableValues: { name: safeName || "la persona indicada" } }`

---

### MB-DN-02: Fallback sin nombre

| Aspecto | Estado Actual | Propuesta |
|---------|---------------|-----------|
| **Objetivo** | Si `lead.name` es null/undefined, el mensaje se rompe | Fallback graceful |
| **Lógica** | N/A | `${lead.name ?? 'usted'}` o mensaje alternativo sin nombre |
| **Alternativa** | Mensaje sin nombre: "Hola, buenas tardes. Soy <OPERADOR_INTERNO> de <CLIENTE_DEMO>..." | Evaluar cuál suena más natural |
| **Prueba** | `curl POST /call/test/direct` SIN `lead_name` → verificar mensaje fallback |
| **Riesgo** | Bajo |

**Opciones de fallback (validado con Codex):**
1. ~~`"Hola, ¿hablo con usted?"` — suena raro~~ ❌
2. `"Hola, buenas tardes. Soy <OPERADOR_INTERNO> de <CLIENTE_DEMO>, le llamo porque..."` — más natural ✅
3. `"Hola, ¿hablo con la persona indicada?"` — formal pero funcional
4. `"Hola, ¿me comunico con alguien de [empresa]?"` — si hay empresa disponible

**Recomendación:** Opción 2 (sin nombre, directo al grano) — **Codex concuerda**

---

### MB-DN-03: Test unitario

| Aspecto | Estado Actual | Propuesta |
|---------|---------------|-----------|
| **Objetivo** | No hay tests del payload | Test que verifica estructura correcta |
| **Archivo** | Nuevo: `apps/api/src/__tests__/call-payload.test.ts` |
| **Framework** | Vitest (ya en devDependencies) |
| **Casos** | 1) Con nombre → incluye nombre, 2) Sin nombre → fallback |
| **Prueba** | `pnpm test` pasa |

---

### MB-DN-04: Test E2E

| Aspecto | Estado Actual | Propuesta |
|---------|---------------|-----------|
| **Objetivo** | Verificar que VAPI recibe y usa el nombre | Llamada real de prueba |
| **Método** | `curl POST /call/test/direct` con nombre de prueba |
| **Verificación** | Escuchar llamada, confirmar que dice el nombre correcto |
| **Número destino** | Número verificado de <OPERADOR_INTERNO> |
| **Riesgo** | Consume créditos Twilio Trial |

---

## Decisiones Pendientes (para <OPERADOR_INTERNO>)

1. **Fallback preferido:** ¿Cuál de las 3 opciones cuando no hay nombre?
2. **Mensaje completo:** ¿El firstMessage actual está bien o quieres ajustarlo?
3. **Tests:** ¿Priorizar tests o ir directo a E2E?

---

## ✅ Validación Codex (completada 2026-02-18)

**Resultado:** Plan aprobado con mejoras

| Pregunta | Respuesta Codex |
|----------|-----------------|
| ¿assistantOverrides correcto? | ✅ Sí, documentado en VAPI |
| Edge cases | `""` no cubierto por `??`, TTS con nombres raros, firstMessage largo |
| Mejoras | `trim()` + fallback explícito, o variables dinámicas VAPI |
| Fallback "usted" | ❌ Suena raro → mejor "buenas tardes" sin nombre |

**Fuentes citadas por Codex:**
- docs.vapi.ai/assistants/dynamic-variables
- support.vapi.ai (ejemplos de assistantOverrides)
