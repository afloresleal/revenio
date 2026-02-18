# Plan: Nombre Dinámico con Variables VAPI (v2 escalable)

**Validado por Codex:** 2026-02-18
**Approach:** Variables dinámicas en VAPI dashboard + `variableValues` en payload

---

## Microbloques

| ID | Nombre | Tiempo | Dependencia |
|----|--------|--------|-------------|
| MB-DN-01 | Configurar variable {{name}} en VAPI dashboard | 10 min | — |
| MB-DN-02 | Actualizar payload con variableValues | 15 min | MB-DN-01 |
| MB-DN-03 | Sanitizar nombre en backend | 10 min | — |
| MB-DN-04 | Test E2E con llamada real | 15 min | MB-DN-01, MB-DN-02, MB-DN-03 |

**Total estimado:** 50 min

---

## Fichas Técnicas

### MB-DN-01: Configurar variable en VAPI Dashboard

| Aspecto | Valor |
|---------|-------|
| **Objetivo** | Definir `{{name}}` como variable dinámica en firstMessage |
| **Herramienta** | VAPI Dashboard → Assistant → First Message |
| **Assistant ID** | `675d2cb2-7047-4949-8735-bedb29351991` |
| **firstMessage actual** | `"Hola, ¿hablo con Valeria? Soy Marina de Casalba..."` |
| **firstMessage nuevo** | `"Hola, ¿hablo con {{name}}? Soy Marina de Casalba, le llamo porque nos contactó por uno de nuestros desarrollos. ¿Me permite transferirle con uno de nuestros asesores?"` |
| **Fallback en VAPI** | Configurar default value para `{{name}}` = vacío (el backend manejará) |
| **Verificación** | GET /assistant/{id} → confirmar `firstMessage` contiene `{{name}}` |
| **Riesgo** | Bajo — cambio en dashboard, no afecta código |

**Comando de verificación:**
```bash
curl -s -H "Authorization: Bearer $VAPI_API_KEY" \
  https://api.vapi.ai/assistant/675d2cb2-7047-4949-8735-bedb29351991 \
  | jq '.firstMessage'
```

---

### MB-DN-02: Actualizar payload con variableValues

| Aspecto | Valor |
|---------|-------|
| **Objetivo** | Enviar nombre del lead como variable dinámica |
| **Archivo** | `apps/api/src/server.ts` |
| **Endpoints afectados** | `/call/test` (línea ~295), `/call/test/direct` (línea ~360) |
| **Cambio** | Agregar `assistantOverrides.variableValues` al payload |
| **Dependencias** | MB-DN-01 (variable debe existir en VAPI), MB-DN-03 (nombre sanitizado) |

**Código actual:**
```typescript
const payload = {
  phoneNumberId: resolvedVapiPhoneNumberId,
  assistantId: resolvedVapiAssistantId,
  customer: { number: to_number },
  metadata: { lead_id: lead.id, attempt_id: attempt.id },
};
```

**Código propuesto:**
```typescript
const payload = {
  phoneNumberId: resolvedVapiPhoneNumberId,
  assistantId: resolvedVapiAssistantId,
  customer: { number: to_number },
  metadata: { lead_id: lead.id, attempt_id: attempt.id },
  assistantOverrides: {
    variableValues: {
      name: safeName || "la persona indicada"
    }
  }
};
```

**Verificación:**
```bash
# Revisar logs del servidor al hacer llamada
# Debe mostrar payload con assistantOverrides.variableValues.name
```

**Riesgo** | Bajo — agregar campo, no modificar lógica existente |

---

### MB-DN-03: Sanitizar nombre en backend

| Aspecto | Valor |
|---------|-------|
| **Objetivo** | Limpiar `lead.name` antes de enviar a VAPI |
| **Archivo** | `apps/api/src/server.ts` |
| **Ubicación** | Antes de construir `payload` en ambos endpoints |

**Código propuesto:**
```typescript
// Sanitizar nombre (edge cases: null, undefined, "", espacios)
const safeName = lead.name?.trim() || null;

// Opcional: normalizar caracteres problemáticos para TTS
// const safeName = lead.name?.trim().replace(/[^\w\sáéíóúñÁÉÍÓÚÑ]/g, '') || null;
```

**Edge cases cubiertos:**
| Input | Output |
|-------|--------|
| `null` | `null` |
| `undefined` | `null` |
| `""` | `null` |
| `"   "` | `null` |
| `"  Juan  "` | `"Juan"` |
| `"María José"` | `"María José"` |

**Verificación:**
```typescript
// Test unitario
expect(sanitizeName(null)).toBe(null);
expect(sanitizeName("")).toBe(null);
expect(sanitizeName("  ")).toBe(null);
expect(sanitizeName("  Juan  ")).toBe("Juan");
```

**Riesgo** | Bajo — función pura, fácil de testear |

---

### MB-DN-04: Test E2E con llamada real

| Aspecto | Valor |
|---------|-------|
| **Objetivo** | Verificar que VAPI usa el nombre dinámico |
| **Prerequisitos** | MB-DN-01, MB-DN-02, MB-DN-03 completados |
| **Método** | Llamada real via `/call/test/direct` |

**Test Case 1: Con nombre**
```bash
curl -X POST http://localhost:3000/call/test/direct \
  -H "Content-Type: application/json" \
  -d '{
    "to_number": "+525527741741",
    "lead_name": "Carlos"
  }'
```
**Resultado esperado:** Marina dice "Hola, ¿hablo con Carlos?"

**Test Case 2: Sin nombre**
```bash
curl -X POST http://localhost:3000/call/test/direct \
  -H "Content-Type: application/json" \
  -d '{
    "to_number": "+525527741741"
  }'
```
**Resultado esperado:** Marina dice "Hola, ¿hablo con la persona indicada?"

**Test Case 3: Nombre vacío**
```bash
curl -X POST http://localhost:3000/call/test/direct \
  -H "Content-Type: application/json" \
  -d '{
    "to_number": "+525527741741",
    "lead_name": "   "
  }'
```
**Resultado esperado:** Marina dice "Hola, ¿hablo con la persona indicada?"

**Verificación adicional:**
- Escuchar la llamada
- Revisar transcript en VAPI dashboard
- Confirmar que `{{name}}` se reemplazó correctamente

**Riesgo** | Medio — consume créditos Twilio Trial |

---

## Orden de Ejecución

```
MB-DN-01 (VAPI Dashboard) ──┐
                            ├──► MB-DN-04 (Test E2E)
MB-DN-03 (Sanitizar) ───────┤
                            │
MB-DN-02 (Payload) ─────────┘
```

MB-DN-01 y MB-DN-03 pueden ejecutarse en paralelo.
MB-DN-02 depende de que MB-DN-03 esté listo (usa `safeName`).
MB-DN-04 requiere todos los anteriores.

---

## Escalabilidad Futura

Con este approach, agregar más variables es trivial:

```typescript
assistantOverrides: {
  variableValues: {
    name: safeName || "la persona indicada",
    desarrollo: lead.interest || "nuestros desarrollos",
    asesor: getAvailableAdvisor() || "uno de nuestros asesores"
  }
}
```

Y en VAPI dashboard:
```
"Hola, ¿hablo con {{name}}? Le llamo por {{desarrollo}}. ¿Me permite transferirle con {{asesor}}?"
```

---

## Validación Codex ✅

| Punto | Resultado |
|-------|-----------|
| `assistantOverrides.variableValues` correcto | ✅ Documentado en docs.vapi.ai |
| Edge case `""` cubierto | ✅ Con `trim() \|\| null` |
| Fallback natural | ✅ "la persona indicada" aprobado |
| Escalabilidad | ✅ Agregar variables sin tocar código |
