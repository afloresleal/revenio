# Scripts de Testing y Validación — Revenio

Scripts helper para validar código antes de commit y detectar errores comunes.

---

## 📜 Scripts Disponibles

### `pre-commit-check.sh`

**Propósito:** Validación completa antes de commit

**Qué verifica:**
- ✅ TypeScript compila sin errores
- ✅ Build exitoso
- ✅ Tests pasan
- ⚠️ Console.log statements
- ❌ Secrets hardcodeados
- ⚠️ CHANGELOG.md actualizado

**Uso:**
```bash
./scripts/pre-commit-check.sh
```

**Cuándo usar:**
- Antes de cada commit
- <AI_ASSISTANT> lo corre automáticamente antes de decir "feature completa"

---

### `check-field-propagation.sh`

**Propósito:** Verificar que un campo nuevo se propagó correctamente en todo el codebase

**Qué verifica:**
- ✅ Campo existe en Prisma schema
- ✅ Campo en tipos TypeScript
- ⚠️ Tipos duplicados
- ✅ Campo en funciones de mapping
- ✅ Campo en tests

**Uso:**
```bash
./scripts/check-field-propagation.sh <fieldName> [modelName]
```

**Ejemplos:**
```bash
# Verificar que callWindowEndHour se propagó correctamente
./scripts/check-field-propagation.sh callWindowEndHour GhlCampaign

# Verificar transferStatus
./scripts/check-field-propagation.sh transferStatus
```

**Output esperado:**
```
🔍 Checking propagation of field: callWindowEndHour
   Model: GhlCampaign

1️⃣ Prisma Schema
   ✅ Found in schema.prisma:
   callWindowEndHour    Int?

2️⃣ TypeScript Types
   Found 8 occurrences in TypeScript files:
   apps/api/src/lib/ghl-campaigns.ts:  callWindowEndHour?: number | null;
   apps/api/src/routes/webhooks.ts:  callWindowEndHour?: number | null;
   ...

3️⃣ Checking for duplicate type definitions of GhlCampaign
   ⚠️  Found 2 type definitions:
   apps/api/src/lib/ghl-campaigns.ts:export type GhlCampaignConfig = {
   apps/api/src/routes/webhooks.ts:type GhlCampaignConfig = {

4️⃣ Common Mapping Functions
   Functions containing 'resolve' and 'ghlcampaign':
      📄 apps/api/src/routes/webhooks.ts
         ✅ Uses callWindowEndHour
   Functions containing 'normalize' and 'ghlcampaign':
      📄 apps/api/src/lib/ghl-campaigns.ts
         ✅ Uses callWindowEndHour

5️⃣ Tests
   ✅ Found in tests:
   apps/api/test/webhooks-resolve-ghl-campaign.test.ts:assert.equal(resolved.callWindowEndHour, 22);

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Checklist for field: callWindowEndHour

Verify that callWindowEndHour exists in:
  [x] Prisma schema (schema.prisma)
  [x] TypeScript type definition(s)
  [x] All mapping functions (resolve, normalize, serialize)
  [x] Tests (propagation test)
```

**Cuándo usar:**
- Después de agregar un campo nuevo a un modelo
- <AI_ASSISTANT> lo corre automáticamente cuando agrega campos
- Antes de crear PR con cambios en modelos

---

## 🚀 Uso en Workflow de <AI_ASSISTANT>

### Cuando <AI_ASSISTANT> implementa una feature:

**PASO 1:** Antes de escribir código
```bash
# Si va a modificar GhlCampaign:
grep -r "type.*GhlCampaign" apps/api/src/
```

**PASO 2:** Después de implementar
```bash
# Si agregó campo "nuevoField":
./scripts/check-field-propagation.sh nuevoField GhlCampaign
```

**PASO 3:** Antes de decir "feature completa"
```bash
./scripts/pre-commit-check.sh
```

**PASO 4:** Mostrar resultado al usuario
```
✅ Feature implementada: [NOMBRE]

Validaciones:
✅ Build exitoso
✅ Tests pasando (3/3)
✅ TypeScript sin errores
✅ Campo propagado correctamente (verified with check-field-propagation.sh)
✅ Pre-commit checks pass
```

---

## 📦 Agregar al package.json

Para hacer los scripts más fáciles de usar, agregar:

```json
{
  "scripts": {
    "precommit": "./scripts/pre-commit-check.sh",
    "check-field": "./scripts/check-field-propagation.sh",
    "validate": "npm run precommit"
  }
}
```

Entonces puedes correr:
```bash
npm run precommit
npm run check-field callWindowEndHour GhlCampaign
```

---

## 🧪 Testing Strategy

### Para features nuevas:

1. **Implementar código**
2. **Correr:** `./scripts/check-field-propagation.sh [field] [model]` (si aplica)
3. **Escribir tests**
4. **Correr:** `./scripts/pre-commit-check.sh`
5. **Fix cualquier issue**
6. **Repetir 4-5 hasta que pase**
7. **Commit**

### Para bugs:

1. **Implementar fix**
2. **Escribir test de regresión** (previene que bug vuelva)
3. **Correr:** `./scripts/pre-commit-check.sh`
4. **Commit**

---

## 🎯 Goals de Testing

**Mínimo aceptable:**
- Build pasa ✅
- TypeScript compila ✅
- Tests existen y pasan ✅

**Ideal:**
- Coverage > 70%
- Tests de integración para features críticas
- Tests de regresión para cada bug arreglado
- Manual testing en staging antes de production

---

## 🔧 Troubleshooting

### Script no es ejecutable

```bash
chmod +x scripts/pre-commit-check.sh
chmod +x scripts/check-field-propagation.sh
```

### Tests fallan

```bash
# Ver detalles del error:
npm -w apps/api test

# Correr test específico:
npm -w apps/api test apps/api/test/specific-test.test.ts
```

### Build falla

```bash
# Ver error completo:
npm -w apps/api run build

# TypeScript errors:
npm -w apps/api exec tsc --noEmit
```

---

**Última actualización:** 2026-05-16
**Mantenido por:** <USUARIO_INTERNO> + <AI_ASSISTANT>
