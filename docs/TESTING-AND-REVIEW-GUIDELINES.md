# Testing & Code Review Guidelines — Revenio

> **Propósito:** Prevenir bugs de producción y asegurar calidad en features críticas de llamadas.
> **Última actualización:** 2026-05-16
> **Basado en:** Lecciones aprendidas de bugs en blind-transfer fix y callWindow propagation

---

## 🎯 Principios Core

1. **Revenio maneja llamadas de producción** → Un bug puede significar pérdida de leads o mala experiencia del cliente
2. **Features requieren configuración externa** → Vapi, Twilio, GHL deben estar documentados
3. **Datos fluyen por múltiples capas** → DB → Prisma → Tipos → Funciones → Webhook → Externa
4. **Sin tests = bug invisible** → Si no hay test, el bug eventualmente aparecerá

---

## 📋 Checklist: Implementando Nueva Feature

### 1. Planning (Antes de escribir código)

- [ ] **Documentar decisión arquitectural** en `/docs/ANALYSIS-*.md`
- [ ] **Identificar dependencias externas:** ¿Requiere config en Vapi/Twilio/GHL?
- [ ] **Definir success criteria:** ¿Cómo sabré que funciona correctamente?
- [ ] **Identificar edge cases:** ¿Qué puede fallar? ¿Qué pasa si el servicio externo no responde?

### 2. Database Changes

- [ ] Crear migración Prisma con nombre descriptivo
- [ ] Campos nullable para backward compatibility (a menos que sea tabla nueva)
- [ ] Actualizar `schema.prisma`
- [ ] Correr migración localmente: `npm -w apps/api exec prisma migrate dev`
- [ ] Verificar que `prisma generate` corre sin errores

### 3. Types & Data Flow

**CRÍTICO:** Evitar tipos duplicados y verificar propagación de datos.

- [ ] **Buscar tipos duplicados:** `grep -r "type.*GhlCampaign\|type.*Transfer" apps/api/src/`
- [ ] Si hay tipos duplicados, consolidar en un solo lugar (preferir `lib/*.ts`)
- [ ] Seguir flujo de datos completo:
  ```
  DB (Prisma) → función de mapping → objeto TypeScript → consumidor final
  ```
- [ ] Para cada nueva columna DB, verificar que se copia en TODAS las funciones de mapping:
  - [ ] `resolveGhlCampaign()` en `webhooks.ts`
  - [ ] `normalizeStoredGhlCampaign()` en `ghl-campaigns.ts`
  - [ ] Serializers en `server.ts` (si aplica)

**Ejemplo de verificación:**
```bash
# Si agregaste campo "callWindowEndHour", buscar que se use en todos lados:
grep -r "callWindowEndHour" apps/api/src/
```

### 4. Code Implementation

- [ ] Implementar lógica core
- [ ] Manejar edge cases (null, undefined, valores inválidos)
- [ ] Logging adecuado para debugging:
  ```typescript
  console.log('callWindow evaluation:', {
    campaignId,
    allowed: callWindow.allowed,
    reason: callWindow.reason
  });
  ```
- [ ] Error handling con mensajes descriptivos
- [ ] No hardcodear valores (usar variables de entorno o config)

### 5. External Service Configuration

**Si la feature requiere configuración en Vapi/Twilio/GHL:**

- [ ] **Documentar en CHANGELOG.md** bajo sección "Configuración requerida"
- [ ] **Crear/actualizar docs** con screenshots paso a paso
- [ ] **Incluir en commit message** los pasos de configuración necesarios
- [ ] Verificar configuración en:
  - [ ] Staging environment
  - [ ] Production environment (o documentar para deploy)

**Ejemplo (de blind-transfer fix):**
```markdown
## Configuración requerida en Vapi Dashboard:
1. Crear tool `transfer_call_tool` en Tools section
2. Agregar el tool al assistant en la sección "Tools"
3. Configurar Webhook Server URL: `https://revenioapi-[env].up.railway.app/webhooks/vapi/events`
```

### 6. Testing

**Unit Tests:**
- [ ] Test para función de lógica core
- [ ] Test para casos feliz path
- [ ] Test para edge cases (null, undefined, valores inválidos)
- [ ] Test para backward compatibility (si aplica)

**Integration Tests:**
- [ ] Test que verifica propagación de datos DB → función final
- [ ] Test que mockea llamadas a servicios externos
- [ ] Test de regresión (prevenir que bug vuelva a ocurrir)

**Ejemplo (callWindow propagation test):**
```typescript
// Test que previene regresión de bug de propagación
const resolved = await resolveGhlCampaign("test-campaign");
assert.equal(resolved.callWindowEndHour, 22, "must propagate from DB");
```

**Manual Testing:**
- [ ] Probar en ambiente local
- [ ] Probar en staging con datos reales
- [ ] Verificar logs en Railway para confirmar flujo correcto
- [ ] Probar escenario de fallo (¿qué pasa cuando algo sale mal?)

### 7. Documentation

- [ ] Actualizar `CHANGELOG.md` con entry descriptivo
- [ ] Si es feature mayor, crear `docs/IMPLEMENTED-YYYY-MM-DD-*.md`
- [ ] Actualizar `README.md` si cambian endpoints o configuración
- [ ] Screenshots si cambia UI (Admin panel)
- [ ] Commit message descriptivo con contexto

### 8. Pre-Merge Review

- [ ] **Self-review:** Leer el diff completo antes de pedir review
- [ ] Verificar que no quedaron `console.log()` de debugging innecesarios
- [ ] Verificar que no se commitean secrets o API keys
- [ ] Correr linter: `npm run lint` (si existe)
- [ ] Correr tests: `npm test`
- [ ] Build exitoso: `npm -w apps/api run build`

---

## 🔍 Code Review Checklist (Para Reviewer)

### General

- [ ] **¿El PR tiene descripción clara?** (problema + solución + testing)
- [ ] **¿Los nombres de variables/funciones son descriptivos?**
- [ ] **¿El código es fácil de entender?** (si necesita comentarios, probablemente necesita refactoring)
- [ ] **¿Hay código duplicado que puede ser extraído?**

### Data Flow & Types

- [ ] **¿Se agregaron nuevos campos a un modelo de DB?**
  - ¿Se actualizaron TODAS las funciones que mapean ese modelo?
  - ¿Hay tipos duplicados del mismo modelo?
- [ ] **¿Los tipos TypeScript son precisos?** (no usar `any` sin justificación)
- [ ] **¿Los campos opcionales (`?`) son realmente opcionales?**

### External Dependencies

- [ ] **¿La feature requiere configuración externa?** (Vapi, Twilio, GHL)
  - ¿Está documentada en CHANGELOG?
  - ¿Está documentada en commit message?
  - ¿Hay guía paso a paso?
- [ ] **¿Se agregaron nuevos webhooks o endpoints?**
  - ¿Están configurados en Vapi/Twilio?
  - ¿Hay validación de firma/autenticación?

### Testing

- [ ] **¿Hay tests para la nueva funcionalidad?**
- [ ] **¿Los tests cubren edge cases?** (null, undefined, errores)
- [ ] **¿Hay test de regresión?** (prevenir que bug vuelva)
- [ ] **¿Se probó manualmente en staging?**

### Error Handling & Logging

- [ ] **¿Hay manejo de errores apropiado?**
- [ ] **¿Los errores tienen mensajes descriptivos?**
- [ ] **¿Hay logging suficiente para debugging?**
- [ ] **¿Los logs incluyen context?** (callId, campaignId, etc.)

### Security

- [ ] **¿No se exponen secrets en logs o errores?**
- [ ] **¿Se validan inputs del usuario?**
- [ ] **¿Los webhooks validan firmas?** (Vapi, Twilio)

### Documentation

- [ ] **¿CHANGELOG.md está actualizado?**
- [ ] **¿Hay documentación técnica si es feature mayor?**
- [ ] **¿El commit message es descriptivo?**

---

## 🧪 Testing Strategy por Tipo de Change

### Change: Agregar campo a modelo existente

**Ejemplo:** Agregar `callWindowEndHour` a `GhlCampaign`

**Testing requerido:**
1. **Unit test:** Verificar que función de mapping copia el campo
   ```typescript
   test('resolveGhlCampaign propagates callWindowEndHour', async () => {
     const campaign = await resolveGhlCampaign('test-id');
     expect(campaign.callWindowEndHour).toBe(22);
   });
   ```

2. **Integration test:** Verificar que campo llega hasta consumidor final
   ```typescript
   test('evaluateCampaignCallWindow uses campaign endHour', () => {
     const campaign = { callWindowEndHour: 22 };
     const result = evaluateCampaignCallWindow(campaign);
     expect(result.settings.endHour).toBe(22);
   });
   ```

3. **Manual test:** Configurar en Admin → hacer llamada → verificar logs

### Change: Agregar webhook o endpoint nuevo

**Ejemplo:** Nuevo endpoint `/webhooks/vapi/transfer-destination-request`

**Testing requerido:**
1. **Unit test:** Verificar que handler parsea payload correctamente
2. **Integration test:** Mock de Vapi llamando el endpoint
3. **Manual test en staging:**
   - Configurar Vapi para llamar al endpoint
   - Hacer llamada de prueba
   - Verificar en logs de Railway que webhook fue llamado
   - Verificar que respuesta es correcta

### Change: Modificar lógica de business crítica

**Ejemplo:** Cambiar de blind-transfer a monitored transfer

**Testing requerido:**
1. **Unit tests:** Lógica de failover
2. **Integration tests:** Flujo completo de transfer con múltiples agentes
3. **Manual testing extensivo:**
   - Escenario 1: Primer agente contesta
   - Escenario 2: Primer agente NO contesta, segundo sí
   - Escenario 3: Ninguno contesta
   - Escenario 4: Agente ocupado
4. **Verificar logs** para cada escenario
5. **Verificar dashboard** muestra datos correctos

---

## 🚨 Red Flags en Code Review

**Rechazar PR si:**

❌ **No hay tests** para feature nueva
❌ **No está documentado** cambio que requiere config externa
❌ **Hay tipos duplicados** sin justificación
❌ **Se agregaron campos a DB** pero no se propagan en todas las funciones
❌ **Build falla** o **tests fallan**
❌ **Hay secrets hardcodeados** (API keys, passwords)
❌ **Breaking change** sin plan de migración

**Pedir cambios si:**

⚠️ Nombres de variables poco claros
⚠️ Funciones muy largas (>50 líneas)
⚠️ Código duplicado obvio
⚠️ Falta logging en puntos críticos
⚠️ Error messages genéricos ("Error occurred")
⚠️ No hay validación de inputs

---

## 📚 Testing Commands

```bash
# Correr todos los tests
npm test

# Correr test específico
npm -w apps/api test apps/api/test/webhooks-resolve-ghl-campaign.test.ts

# Correr tests en watch mode (re-run on changes)
npm test -- --watch

# Build (verifica que TypeScript compila)
npm -w apps/api run build

# Lint (si existe)
npm run lint

# Type check sin build
npm -w apps/api exec tsc --noEmit
```

---

## 🔄 Post-Merge Monitoring

**Después de mergear a `develop` o `main`:**

- [ ] Verificar que deploy a Railway fue exitoso
- [ ] Verificar logs de Railway (primeros 10 minutos post-deploy)
- [ ] Hacer llamada de prueba en ambiente correspondiente
- [ ] Verificar dashboard muestra datos correctos
- [ ] Monitorear por 24 horas para detectar problemas

**Si algo falla:**
1. Revertir cambio inmediatamente si es crítico
2. Debuggear en staging (no en producción)
3. Fix + test + re-deploy

---

## 📖 Recursos de Referencia

**Documentación activa:**
- `docs/ACTIVE-architecture.md` - Arquitectura del sistema
- `docs/ACTIVE-vapi-config.md` - Configuración de Vapi
- `docs/ACTIVE-api-reference.md` - Endpoints API

**Features implementadas (para referencia):**
- `docs/IMPLEMENTED-2026-05-14-blind-transfer-fix.md` - Ejemplo de fix con config externa
- `docs/IMPLEMENTED-2026-05-14-call-window-per-campaign.md` - Ejemplo de feature completa

**Tests de ejemplo:**
- `apps/api/test/webhooks-resolve-ghl-campaign.test.ts` - Test de propagación de campos

---

## 💡 Tips para Escribir Buenos Tests

### 1. Nombre descriptivo

❌ Malo:
```typescript
test('test 1', () => { ... });
```

✅ Bueno:
```typescript
test('resolveGhlCampaign propagates callWindow fields from DB', () => { ... });
```

### 2. Arrange-Act-Assert pattern

```typescript
test('evaluateCampaignCallWindow uses campaign endHour not global', () => {
  // Arrange: Setup
  const campaign = { callWindowEndHour: 22 };
  process.env.BUSINESS_END_HOUR = '18';

  // Act: Execute
  const result = evaluateCampaignCallWindow(campaign);

  // Assert: Verify
  expect(result.settings.endHour).toBe(22);
  expect(result.settings.endHour).not.toBe(18);
});
```

### 3. Test una cosa a la vez

❌ Malo (test hace 5 cosas):
```typescript
test('campaign validation', () => {
  // valida name
  // valida timezone
  // valida agents
  // valida call window
  // valida GHL config
});
```

✅ Bueno (tests separados):
```typescript
test('validates campaign name is required', () => { ... });
test('validates timezone is valid IANA string', () => { ... });
test('validates at least one agent is configured', () => { ... });
```

### 4. Incluir mensaje de error descriptivo

```typescript
assert.equal(
  result.settings.endHour,
  22,
  'evaluator must use campaign endHour:22, not global env endHour:18'
  // ↑ Este mensaje ayuda cuando el test falla
);
```

---

## 🎓 Lecciones de Bugs Pasados

### Bug 1: Blind-transfer sin documentar config de Vapi

**Qué pasó:**
- Backend implementó fix eliminando blind-transfer hooks
- Vapi assistant NO tenía configurado el transfer tool
- Transfers fallaban silenciosamente en producción

**Prevención:**
- [ ] **Documentar config externa en CHANGELOG** (ahora mandatory)
- [ ] **Screenshots paso a paso** de configuración en Vapi
- [ ] **Test manual completo** antes de marcar como "done"

### Bug 2: callWindow fields no propagados desde DB

**Qué pasó:**
- Agregamos 6 campos a DB
- Actualizamos tipo en `ghl-campaigns.ts`
- OLVIDAMOS copiar campos en `resolveGhlCampaign()` en `webhooks.ts`
- TypeScript no se quejó (campos opcionales)

**Prevención:**
- [ ] **Buscar tipos duplicados** antes de modificar
- [ ] **Seguir flujo de datos completo:** DB → mapping → consumidor
- [ ] **Test de integración** que valide propagación end-to-end
- [ ] **Grep por nombre de campo** para verificar que se usa en todos lados

---

## 📞 Cuando Pedir Ayuda

**Pide review/ayuda si:**
- No estás seguro si el approach es correcto
- La feature toca código crítico (webhooks, transfer logic)
- No sabes cómo testear algo
- Los tests pasan pero algo se siente "raro"
- Necesitas configurar algo en Vapi/Twilio y no estás seguro

**Es mejor preguntar 5 veces que deployar un bug a producción.**

---

## ✅ Definition of Done

**Una feature está "Done" cuando:**

- [ ] Código implementado y funciona localmente
- [ ] Tests escritos y pasando (unit + integration)
- [ ] Probado manualmente en staging
- [ ] Configuración externa documentada (si aplica)
- [ ] CHANGELOG.md actualizado
- [ ] Docs técnicos actualizados (si aplica)
- [ ] Code review aprobado
- [ ] Merged a develop/main
- [ ] Deployed y verificado en ambiente correspondiente
- [ ] Monitoreado por 24 horas sin issues

---

**Última actualización:** 2026-05-16
**Mantenido por:** Ale + Claude
**Feedback:** Agregar issues/PRs cuando encuentres mejoras a este proceso
