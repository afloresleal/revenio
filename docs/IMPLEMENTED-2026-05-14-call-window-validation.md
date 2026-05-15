# Validación Fase 1: Call Window por Campaña

> **Fecha:** 2026-05-14
> **Commit:** `ffa5e6a`
> **Branch:** `develop` (staging Railway)
> **Estado:** ⏳ Pendiente de validación

## ✅ Lo Que Se Implementó

### Backend Completo
- [x] Migración DB con 6 campos nuevos
- [x] Tipos TypeScript actualizados
- [x] Lógica `evaluateCampaignCallWindow()`
- [x] Integración en endpoint GHL webhooks
- [x] Build exitoso sin errores
- [x] Commit y push a develop

### Próximo Deploy
Railway staging detectará el push automáticamente y:
1. Ejecutará `prisma migrate deploy`
2. Hará build del nuevo código
3. Desplegará la nueva versión

---

## Checklist de Validación

### 1. Verificar Deploy de Railway ⏳

**Dónde:** Railway Dashboard → proyecto revenio (staging environment)

**Pasos:**
1. Abrir Railway dashboard
2. Ir al servicio API staging
3. Verificar que el deploy inició automáticamente
4. Esperar a que termine (status "Success")

**Logs esperados:**
```
✓ Running migration: 20260514210000_add_call_window_to_campaign
✓ Applied migration 20260514210000_add_call_window_to_campaign
✓ Build completed successfully
✓ Deploy successful
```

**Tiempo estimado:** 3-5 minutos

**Resultado esperado:**
- [ ] Deploy completado sin errores
- [ ] API staging responde en `https://revenioapi-staging.up.railway.app/health`

---

### 2. Verificar Migración en Base de Datos ⏳

**Opción A: Desde Railway Dashboard**

1. Railway Dashboard → Postgres (staging)
2. Click en "Data" tab
3. Ejecutar query:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'ghl_campaign'
  AND column_name LIKE 'call_window%'
ORDER BY ordinal_position;
```

**Resultado esperado:**
```
column_name                    | data_type | is_nullable
-------------------------------+-----------+-------------
call_window_enabled            | boolean   | YES
call_window_timezone           | text      | YES
call_window_start_hour         | integer   | YES
call_window_end_hour           | integer   | YES
call_window_weekdays           | text      | YES
call_window_apply_to_failover  | boolean   | YES
```

**Opción B: Desde código local (si tienes acceso a staging DB)**

```bash
cd apps/api
npx prisma studio --schema=prisma/schema.prisma
# Abrir modelo GhlCampaign
# Verificar que aparecen los 6 campos nuevos
```

**Resultado esperado:**
- [ ] 6 columnas nuevas visibles en `ghl_campaign`
- [ ] Todas son nullable (YES)
- [ ] Campañas existentes tienen valores null en estos campos

---

### 3. Verificar Backward Compatibility ⏳

**Objetivo:** Confirmar que campañas existentes siguen funcionando sin configuración específica.

**Prueba A: Verificar campañas existentes**

```sql
-- Ver campañas actuales y sus nuevos campos
SELECT
  campaign_id,
  name,
  active,
  call_window_enabled,
  call_window_timezone,
  call_window_start_hour,
  call_window_end_hour
FROM ghl_campaign
WHERE active = true
ORDER BY created_at DESC
LIMIT 5;
```

**Resultado esperado:**
- [ ] Todas las campañas existentes tienen `call_window_enabled = null`
- [ ] Todos los otros campos de call_window también son null
- [ ] Campo `active` sin cambios

**Prueba B: Crear llamada de prueba desde Lab**

1. Ir a Lab staging: `https://revenio-lab-staging.up.railway.app`
2. Crear llamada con campaña existente
3. Verificar que respeta horario global (no debe dar error)

**Horario global actual (Lab/ENV):**
- Timezone: `America/Mexico_City`
- Horas: 7:00 - 22:00
- Días: Todos los días (0,1,2,3,4,5,6)

**Prueba según hora actual:**

**Si son 8:00 AM - 9:00 PM CST:**
- Llamada debe crearse exitosamente
- No debe aparecer error `outside_business_hours`

**Si son 11:00 PM - 6:00 AM CST:**
- Llamada debe rechazarse con error `outside_business_hours`
- Mensaje: "Llamadas fuera de horario habilitado"

**Resultado esperado:**
- [ ] Horario global sigue funcionando
- [ ] Campañas sin config (null) usan horario global
- [ ] No hay regresiones

---

### 4. Verificar Logs de API ⏳

**Dónde:** Railway Dashboard → API staging → Logs tab

**Buscar:**
- ✅ No hay errores de Prisma relacionados con campos faltantes
- ✅ No hay errores TypeScript en runtime
- ✅ Llamadas se crean normalmente

**Logs normales esperados:**
```
[info] POST /webhooks/gohighlevel
[info] Evaluating call window for campaign: isla-blanca-es
[info] Campaign has no specific call window config, using global
[info] Call window allowed: true
```

**Logs de error a evitar:**
```
❌ ERROR: column "call_window_enabled" does not exist
❌ TypeError: Cannot read property 'callWindowEnabled' of undefined
❌ PrismaClientValidationError: Invalid value for field
```

**Resultado esperado:**
- [ ] No hay errores relacionados con call_window
- [ ] API responde normalmente
- [ ] Webhooks GHL procesan correctamente

---

### 5. Verificar API Health ⏳

**Endpoint:** `GET https://revenioapi-staging.up.railway.app/health`

**Request:**
```bash
curl https://revenioapi-staging.up.railway.app/health
```

**Resultado esperado:**
```json
{
  "ok": true,
  "service": "revenio-api"
}
```

**Status code esperado:** `200 OK`

**Resultado esperado:**
- [ ] API responde correctamente
- [ ] Sin errores 500
- [ ] Deploy completado exitosamente

---

## Problemas Comunes y Soluciones

### Problema 1: Deploy falla con error de migración

**Síntoma:**
```
Error: P3009: migrate found failed migration
```

**Causa:** Migración manual no fue reconocida por Prisma

**Solución:**
```bash
# Conectar a Railway staging DB
cd apps/api
npx prisma migrate resolve --applied 20260514210000_add_call_window_to_campaign
```

### Problema 2: Columnas no aparecen en DB

**Síntoma:** Query de validación no devuelve las 6 columnas

**Causa:** Migración no se ejecutó

**Solución:**
```bash
# Forzar migración manual
cd apps/api
npx prisma migrate deploy
# O desde Railway: Settings → Re-deploy
```

### Problema 3: API devuelve 500 en llamadas

**Síntoma:**
```
TypeError: Cannot read property 'callWindowEnabled' of undefined
```

**Causa:** Prisma Client no se regeneró con nuevos tipos

**Solución:**
```bash
# En Railway, forzar rebuild
Settings → Redeploy
# Esto ejecutará: prisma generate && tsc
```

### Problema 4: Campañas existentes no funcionan

**Síntoma:** Todas las llamadas son rechazadas con `outside_business_hours`

**Causa:** Bug en lógica de fallback

**Solución temporal:**
```sql
-- Verificar que Lab tiene horario habilitado
-- Conectar a Lab staging y verificar configuración
GET https://revenio-lab-staging.up.railway.app/lab/settings/call-window
```

**Solución permanente:** Revisar código de `evaluateCampaignCallWindow()`

---

## Testing Manual Opcional

### Test 1: Campaña con horario global (null)

**Setup en DB:**
```sql
-- Verificar que una campaña tiene null
SELECT campaign_id, call_window_enabled
FROM ghl_campaign
WHERE campaign_id = 'isla-blanca-es';
-- Debe devolver: null
```

**Test desde Lab:**
1. Crear llamada para `isla-blanca-es`
2. Dentro de horario global (7am-10pm CST)
3. Llamada debe crearse exitosamente

**Resultado esperado:**
- [ ] Llamada creada
- [ ] Usa horario global
- [ ] Status: `sent` o `queued`

### Test 2: Actualizar campaña a modo 24/7

**Setup en DB:**
```sql
-- Actualizar una campaña de prueba
UPDATE ghl_campaign
SET call_window_enabled = false
WHERE campaign_id = 'test-1';
```

**Test desde Lab:**
1. Crear llamada para `test-1`
2. Fuera de horario global (ej: 11pm CST)
3. Llamada debe crearse exitosamente (ignora horario)

**Resultado esperado:**
- [ ] Llamada creada incluso fuera de horario global
- [ ] No aparece error `outside_business_hours`

### Test 3: Campaña con horario custom

**Setup en DB:**
```sql
-- Configurar horario custom
UPDATE ghl_campaign
SET
  call_window_enabled = true,
  call_window_timezone = 'America/Los_Angeles',
  call_window_start_hour = 9,
  call_window_end_hour = 17,
  call_window_weekdays = '1,2,3,4,5' -- Lunes a Viernes
WHERE campaign_id = 'test-1';
```

**Test A: Dentro de horario custom (L-V 9am-5pm PST)**
- Llamada debe crearse exitosamente

**Test B: Fuera de horario custom (Sábado o después de 5pm PST)**
- Llamada debe rechazarse con `outside_business_hours`

**Resultado esperado:**
- [ ] Respeta horario custom de la campaña
- [ ] Ignora horario global
- [ ] Mensaje de error menciona timezone correcto

---

## Resumen de Validación

### Checklist Final

**Deploy:**
- [ ] Railway deploy completado sin errores
- [ ] API staging responde en `/health`
- [ ] Logs sin errores de Prisma/TypeScript

**Base de Datos:**
- [ ] 6 columnas nuevas en `ghl_campaign`
- [ ] Todas nullable
- [ ] Campañas existentes con valores null

**Backward Compatibility:**
- [ ] Campañas existentes funcionan sin cambios
- [ ] Horario global sigue aplicando
- [ ] No hay regresiones

**Testing Manual (Opcional):**
- [ ] Test 1: Campaña con null usa global ✅
- [ ] Test 2: Campaña con false permite 24/7 ✅
- [ ] Test 3: Campaña con custom respeta horario ✅

---

## Siguiente Paso: Fase 2

**Una vez validado todo:**

✅ **TODO OK → Continuar con Fase 2 (Admin UI)**

Decirle a Claude:
```
"Fase 1 validada exitosamente. Continuemos con Fase 2 (Admin UI)"
```

Claude implementará:
1. Formulario en Admin con 3 modos (global/custom/24-7)
2. Campos específicos (timezone, horas, días)
3. Validación frontend
4. Endpoint de Admin actualizado

**Estimación Fase 2:** 1 día

---

❌ **Encontraste problemas → Reportar**

Decirle a Claude:
```
"Encontré este problema durante validación: [describir problema]"
```

Claude ayudará a diagnosticar y solucionar.

---

## Referencias

**Código modificado:**
- `apps/api/prisma/schema.prisma` - Schema actualizado
- `apps/api/prisma/migrations/20260514210000_add_call_window_to_campaign/` - Migración SQL
- `apps/api/src/lib/call-window.ts` - Lógica de evaluación
- `apps/api/src/lib/ghl-campaigns.ts` - Tipos actualizados
- `apps/api/src/routes/webhooks.ts` - Integración GHL

**Documentación:**
- `docs/CALL-WINDOW-PER-CAMPAIGN-ANALYSIS.md` - Análisis completo
- `docs/CALL-WINDOW-PHASE1-VALIDATION.md` - Esta guía

**Commit:** `ffa5e6a`
**Branch:** `develop`
**Staging URL:** `https://revenioapi-staging.up.railway.app`
