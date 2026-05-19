# Análisis: Horario de Marcación por Campaña

> **Fecha:** 2026-05-14
> **Objetivo:** Evaluar complejidad de mover configuración de horario desde Lab (global runtime) a Admin (por campaña)
> **Status actual:** Lab controla horario global en memoria (no persiste en DB)

## Resumen Ejecutivo

**Complejidad:** 🟡 **Media** (2-3 días de desarrollo)

**Por qué es media y no baja:**
- Necesita migración de base de datos (6 campos nuevos)
- Cambios en 5 archivos core de la API
- Actualización de Admin UI (formulario + validación)
- Mantener compatibilidad con Lab (modo global fallback)
- Testing exhaustivo por impacto en todas las llamadas

**Valor alto:** Cada campaña puede tener su propio horario de marcación (útil para diferentes zonas horarias, productos, o estrategias de contacto).

---

## Estado Actual (Lab + Variables de Entorno)

### 1. Configuración Actual

**Ubicación:** Lab UI + Variables de entorno

**Control en Lab:**
- `apps/lab/public/index.html` (líneas 129-168)
- Sección "Horario de llamadas (runtime)"
- Endpoints: `GET /lab/settings/call-window`, `POST /lab/settings/call-window`

**Configuración global en memoria:**
```typescript
type CallWindowSettings = {
  enabled: boolean;                     // ¿Está activo el control de horario?
  timezone: string;                     // "America/Mexico_City"
  startHour: number;                    // 7 (7:00 AM)
  endHour: number;                      // 22 (10:00 PM)
  activeWeekdays: number[];             // [0,1,2,3,4,5,6] (Dom-Sáb)
  applyToRoundRobinFailover: boolean;   // ¿Aplicar también al failover?
};
```

**Variables de entorno (fallback):**
```bash
BUSINESS_TZ=America/Mexico_City
BUSINESS_START_HOUR=7
BUSINESS_END_HOUR=22
BUSINESS_DAYS=0,1,2,3,4,5,6          # Lunes a Domingo
BUSINESS_APPLY_TO_RR_FAILOVER=true
BUSINESS_HOURS_ENABLED=true
```

### 2. Cómo Funciona Ahora

**Archivo:** `apps/api/src/lib/call-window.ts`

```typescript
// Settings se guardan EN MEMORIA (no persisten)
let runtimeSettings: CallWindowSettings = { ...defaultSettings };

// Se valida al crear llamada
export function canStartOutboundCall(now: Date = new Date()): CallWindowEvaluation {
  const settings = getCallWindowSettings();
  if (!settings.enabled) return { allowed: true, ... };

  const zoned = getDateInTimezone(settings.timezone);
  const currentHour = zoned.getHours();
  const currentWeekday = zoned.getDay();

  const weekdayAllowed = settings.activeWeekdays.includes(currentWeekday);
  const hourAllowed = isHourWithinWindow(currentHour, settings.startHour, settings.endHour);

  return { allowed: weekdayAllowed && hourAllowed, ... };
}
```

**Validación en endpoints:**
```typescript
// apps/api/src/server.ts (línea 2319)
app.post("/call/vapi", async (req, res) => {
  const callWindow = canStartOutboundCall();
  if (!callWindow.allowed) {
    return res.status(400).json({
      error: 'outside_business_hours',
      message: 'Llamadas fuera de horario habilitado',
      call_window: callWindow,
    });
  }
  // ... continúa creando llamada
});
```

**Endpoints que validan horario:**
1. `POST /call/vapi` (línea 2319)
2. `POST /call/test/direct` (línea 2047)
3. `POST /webhooks/gohighlevel` (línea 1308 en webhooks.ts)
4. `POST /api/admin/ghl-campaigns/:id/test-call` (línea 2947)

### 3. Limitaciones Actuales

❌ **Configuración global:** Todas las campañas comparten el mismo horario
❌ **No persiste:** Se resetea en cada deploy/reinicio de Railway
❌ **No auditable:** No hay historial de cambios
❌ **Manual:** Hay que ir a Lab para cambiar horario

---

## Propuesta: Horario por Campaña

### 1. Nueva Estructura en Base de Datos

**Migración Prisma:**

```prisma
// apps/api/prisma/schema.prisma

model GhlCampaign {
  id                String   @id @default(uuid())
  campaignId        String   @unique @map("campaign_id")

  // ... campos existentes ...

  // 🆕 Nuevos campos de horario
  callWindowEnabled Boolean? @map("call_window_enabled")              // null = usar global
  callWindowTimezone String? @map("call_window_timezone")             // "America/Mexico_City"
  callWindowStartHour Int?   @map("call_window_start_hour")           // 7
  callWindowEndHour Int?     @map("call_window_end_hour")             // 22
  callWindowWeekdays String? @map("call_window_weekdays")             // "0,1,2,3,4,5,6"
  callWindowApplyToFailover Boolean? @map("call_window_apply_to_failover") // true

  @@map("ghl_campaign")
}
```

**Lógica de fallback:**
- Si `callWindowEnabled` es `null` → usar configuración global de Lab/ENV
- Si `callWindowEnabled` es `false` → permitir llamadas 24/7 para esta campaña
- Si `callWindowEnabled` es `true` → usar horario específico de esta campaña

### 2. Cambios en la API

#### 2.1. Nueva función en `call-window.ts`

```typescript
// apps/api/src/lib/call-window.ts

export function evaluateCampaignCallWindow(
  campaign: Pick<GhlCampaign,
    'callWindowEnabled' |
    'callWindowTimezone' |
    'callWindowStartHour' |
    'callWindowEndHour' |
    'callWindowWeekdays' |
    'callWindowApplyToFailover'
  >,
  now: Date = new Date()
): CallWindowEvaluation {
  // Si no tiene configuración específica, usar global
  if (campaign.callWindowEnabled === null || campaign.callWindowEnabled === undefined) {
    return evaluateCallWindow(now);
  }

  // Si está deshabilitado para esta campaña, permitir 24/7
  if (campaign.callWindowEnabled === false) {
    return {
      allowed: true,
      reason: 'disabled',
      timezone: campaign.callWindowTimezone || DEFAULT_TIMEZONE,
      currentHour: -1,
      currentWeekday: -1,
      settings: { enabled: false, ... },
    };
  }

  // Usar configuración específica de la campaña
  const settings: CallWindowSettings = {
    enabled: true,
    timezone: campaign.callWindowTimezone || DEFAULT_TIMEZONE,
    startHour: campaign.callWindowStartHour ?? DEFAULT_START_HOUR,
    endHour: campaign.callWindowEndHour ?? DEFAULT_END_HOUR,
    activeWeekdays: parseWeekdaysString(campaign.callWindowWeekdays),
    applyToRoundRobinFailover: campaign.callWindowApplyToFailover ?? true,
  };

  return evaluateCallWindowWithSettings(settings, now);
}

function parseWeekdaysString(raw: string | null | undefined): number[] {
  if (!raw) return DEFAULT_ACTIVE_WEEKDAYS;
  return raw.split(',').map(n => parseInt(n, 10)).filter(n => n >= 0 && n <= 6);
}
```

#### 2.2. Actualizar endpoint GHL

```typescript
// apps/api/src/routes/webhooks.ts (línea 1308)

router.post('/gohighlevel', async (req, res) => {
  // ... obtener campaign ...

  // 🔄 CAMBIO: Usar horario de campaña en vez de global
  const callWindow = evaluateCampaignCallWindow(campaign);
  if (!callWindow.allowed) {
    return { ok: false, error: 'outside_business_hours', callWindow };
  }

  // ... continúa creando llamada ...
});
```

#### 2.3. Actualizar otros endpoints

Mismo patrón para:
- `POST /api/admin/ghl-campaigns/:id/test-call` (usa campaña específica)
- `POST /call/vapi` y `POST /call/test/direct` (pueden usar global por ahora)

### 3. Cambios en Admin UI

**Archivo:** `apps/admin/public/index.html` y `apps/admin/public/app.js`

**Nueva sección en el formulario:**

```html
<!-- Después de la sección de Custom Fields -->

<div class="section">
  <div class="section-header">
    <h3>Horario de Llamadas</h3>
    <p class="help-text">
      Configura cuándo se pueden realizar llamadas para esta campaña.
      Si no configuras nada, se usa el horario global del sistema.
    </p>
  </div>

  <div class="form-group">
    <label>
      <input type="radio" name="call_window_mode" value="global" checked />
      Usar horario global del sistema
    </label>
  </div>

  <div class="form-group">
    <label>
      <input type="radio" name="call_window_mode" value="custom" />
      Configurar horario específico para esta campaña
    </label>
  </div>

  <div class="form-group">
    <label>
      <input type="radio" name="call_window_mode" value="disabled" />
      Permitir llamadas 24/7 (sin restricción de horario)
    </label>
  </div>

  <!-- Campos específicos (se muestran solo si mode=custom) -->
  <div id="call_window_custom_fields" style="display:none;">
    <div class="form-row">
      <div class="form-group">
        <label for="call_window_timezone">Zona Horaria (IANA)</label>
        <select id="call_window_timezone" class="form-input">
          <option value="America/Mexico_City">Ciudad de México (CST)</option>
          <option value="America/New_York">New York (EST)</option>
          <option value="America/Los_Angeles">Los Angeles (PST)</option>
          <option value="America/Chicago">Chicago (CST)</option>
          <option value="America/Denver">Denver (MST)</option>
          <option value="America/Phoenix">Phoenix (MST sin DST)</option>
        </select>
        <p class="help-text">
          Zona horaria para evaluar el horario de llamadas.
        </p>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="call_window_start_hour">Hora Inicio (0-23)</label>
        <input type="number" id="call_window_start_hour" class="form-input"
               min="0" max="23" placeholder="7" />
        <p class="help-text">Hora de inicio (formato 24h, ej: 7 = 7:00 AM)</p>
      </div>

      <div class="form-group">
        <label for="call_window_end_hour">Hora Fin (0-23)</label>
        <input type="number" id="call_window_end_hour" class="form-input"
               min="0" max="23" placeholder="22" />
        <p class="help-text">Hora de fin (formato 24h, ej: 22 = 10:00 PM)</p>
      </div>
    </div>

    <div class="form-group">
      <label>Días Activos</label>
      <div class="checkbox-group">
        <label><input type="checkbox" class="weekday-checkbox" value="0" checked /> Domingo</label>
        <label><input type="checkbox" class="weekday-checkbox" value="1" checked /> Lunes</label>
        <label><input type="checkbox" class="weekday-checkbox" value="2" checked /> Martes</label>
        <label><input type="checkbox" class="weekday-checkbox" value="3" checked /> Miércoles</label>
        <label><input type="checkbox" class="weekday-checkbox" value="4" checked /> Jueves</label>
        <label><input type="checkbox" class="weekday-checkbox" value="5" checked /> Viernes</label>
        <label><input type="checkbox" class="weekday-checkbox" value="6" checked /> Sábado</label>
      </div>
    </div>

    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="call_window_apply_to_failover" checked />
        Aplicar horario también al failover de Round Robin
      </label>
      <p class="help-text">
        Si está activo, el failover a otros agentes también respetará este horario.
        Si está desactivado, el failover puede ocurrir fuera del horario.
      </p>
    </div>
  </div>
</div>
```

**Lógica JavaScript:**

```javascript
// apps/admin/public/app.js

// Mostrar/ocultar campos custom según el modo seleccionado
document.querySelectorAll('input[name="call_window_mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const customFields = document.getElementById('call_window_custom_fields');
    customFields.style.display = radio.value === 'custom' ? 'block' : 'none';
  });
});

// Al cargar campaña
function loadCampaign(campaign) {
  // ... cargar otros campos ...

  // Determinar modo
  if (campaign.callWindowEnabled === null || campaign.callWindowEnabled === undefined) {
    document.querySelector('input[name="call_window_mode"][value="global"]').checked = true;
  } else if (campaign.callWindowEnabled === false) {
    document.querySelector('input[name="call_window_mode"][value="disabled"]').checked = true;
  } else {
    document.querySelector('input[name="call_window_mode"][value="custom"]').checked = true;
    document.getElementById('call_window_custom_fields').style.display = 'block';

    // Cargar valores
    document.getElementById('call_window_timezone').value =
      campaign.callWindowTimezone || 'America/Mexico_City';
    document.getElementById('call_window_start_hour').value =
      campaign.callWindowStartHour ?? 7;
    document.getElementById('call_window_end_hour').value =
      campaign.callWindowEndHour ?? 22;

    // Cargar weekdays
    const weekdays = (campaign.callWindowWeekdays || '0,1,2,3,4,5,6').split(',');
    document.querySelectorAll('.weekday-checkbox').forEach(checkbox => {
      checkbox.checked = weekdays.includes(checkbox.value);
    });

    document.getElementById('call_window_apply_to_failover').checked =
      campaign.callWindowApplyToFailover ?? true;
  }
}

// Al guardar campaña
function saveCampaign() {
  const mode = document.querySelector('input[name="call_window_mode"]:checked').value;

  const payload = {
    // ... otros campos ...
  };

  if (mode === 'global') {
    // No enviar nada (null en DB)
    payload.callWindowEnabled = null;
  } else if (mode === 'disabled') {
    payload.callWindowEnabled = false;
  } else {
    // mode === 'custom'
    const weekdays = Array.from(document.querySelectorAll('.weekday-checkbox:checked'))
      .map(cb => cb.value)
      .join(',');

    payload.callWindowEnabled = true;
    payload.callWindowTimezone = document.getElementById('call_window_timezone').value;
    payload.callWindowStartHour = parseInt(document.getElementById('call_window_start_hour').value, 10);
    payload.callWindowEndHour = parseInt(document.getElementById('call_window_end_hour').value, 10);
    payload.callWindowWeekdays = weekdays;
    payload.callWindowApplyToFailover = document.getElementById('call_window_apply_to_failover').checked;
  }

  // ... enviar al backend ...
}
```

### 4. Validación en Backend

```typescript
// apps/api/src/server.ts

app.post("/api/admin/ghl-campaigns", async (req, res) => {
  const validation = z.object({
    // ... campos existentes ...
    callWindowEnabled: z.boolean().nullable().optional(),
    callWindowTimezone: z.string().optional(),
    callWindowStartHour: z.number().min(0).max(23).optional(),
    callWindowEndHour: z.number().min(0).max(23).optional(),
    callWindowWeekdays: z.string().regex(/^[0-6](,[0-6])*$/).optional(),
    callWindowApplyToFailover: z.boolean().optional(),
  });

  const parsed = validation.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'validation_error', details: parsed.error });
  }

  // Validar lógica de horario
  if (parsed.data.callWindowEnabled === true) {
    if (!parsed.data.callWindowTimezone) {
      return res.status(400).json({
        error: 'missing_timezone',
        message: 'Timezone es requerido cuando callWindowEnabled es true'
      });
    }
    if (parsed.data.callWindowStartHour === undefined) {
      return res.status(400).json({
        error: 'missing_start_hour',
        message: 'Start hour es requerido cuando callWindowEnabled es true'
      });
    }
    // ... más validaciones ...
  }

  // ... crear/actualizar campaña ...
});
```

---

## Plan de Implementación

### Fase 1: Base de Datos (0.5 días)

**Tareas:**
1. Crear migración Prisma con 6 campos nuevos
2. Ejecutar migración en staging
3. Verificar que no rompe nada existente

**Archivos:**
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/YYYYMMDDHHMMSS_add_call_window_to_campaign/migration.sql`

**Validación:**
```bash
npm -w apps/api exec prisma migrate dev --name add_call_window_to_campaign
npm -w apps/api exec prisma generate
```

### Fase 2: Lógica de Evaluación (1 día)

**Tareas:**
1. Agregar `evaluateCampaignCallWindow()` en `call-window.ts`
2. Actualizar tipos TypeScript
3. Escribir tests unitarios
4. Actualizar endpoint GHL para usar horario de campaña

**Archivos:**
- `apps/api/src/lib/call-window.ts` (+80 líneas)
- `apps/api/src/lib/ghl-campaigns.ts` (actualizar tipos)
- `apps/api/src/routes/webhooks.ts` (cambiar línea 1308)
- `apps/api/test/call-window.test.ts` (nuevo archivo de tests)

**Tests sugeridos:**
```typescript
describe('evaluateCampaignCallWindow', () => {
  it('usa configuración global cuando callWindowEnabled es null', () => {
    const campaign = { callWindowEnabled: null };
    const result = evaluateCampaignCallWindow(campaign);
    expect(result.settings).toEqual(getCallWindowSettings());
  });

  it('permite 24/7 cuando callWindowEnabled es false', () => {
    const campaign = { callWindowEnabled: false };
    const result = evaluateCampaignCallWindow(campaign);
    expect(result.allowed).toBe(true);
  });

  it('respeta horario custom de campaña', () => {
    const campaign = {
      callWindowEnabled: true,
      callWindowTimezone: 'America/Mexico_City',
      callWindowStartHour: 9,
      callWindowEndHour: 17,
      callWindowWeekdays: '1,2,3,4,5', // Lunes a Viernes
    };
    // Test con fecha en horario y fuera de horario
  });
});
```

### Fase 3: Admin UI (1 día)

**Tareas:**
1. Agregar sección de horario al formulario
2. Implementar lógica de modo (global/custom/disabled)
3. Validación frontend
4. Actualizar endpoints de admin para aceptar nuevos campos

**Archivos:**
- `apps/admin/public/index.html` (+100 líneas)
- `apps/admin/public/app.js` (+150 líneas)
- `apps/api/src/server.ts` (actualizar validación Zod)

**Validaciones frontend:**
- Start hour < end hour (o permitir overnight si start > end)
- Timezone válido
- Al menos 1 día activo
- Campos numéricos en rango 0-23

### Fase 4: Testing & Docs (0.5 días)

**Tareas:**
1. Pruebas end-to-end en staging
2. Actualizar docs de Admin
3. Agregar sección en CHANGELOG
4. Crear guía de migración para usuarios de Lab

**Archivos:**
- `docs/ADMIN-GHL-CAMPAIGNS.md` (actualizar)
- `docs/CALL-WINDOW-MIGRATION.md` (nuevo)
- `CHANGELOG.md` (agregar v0.4.0)

---

## Estimación de Complejidad

### Métricas de Cambio

| Categoría | Cambios | Complejidad |
|-----------|---------|-------------|
| Migración DB | 1 migración, 6 campos | 🟢 Baja |
| Backend Logic | ~150 líneas nuevas | 🟡 Media |
| Admin UI | ~250 líneas nuevas | 🟡 Media |
| Testing | 3 archivos de tests | 🟢 Baja |
| Docs | 2 archivos nuevos/actualizados | 🟢 Baja |

**Total:** 🟡 **Complejidad Media** (2-3 días de desarrollo)

### Riesgos

**🔴 Alto Riesgo:**
- Ninguno (no rompe funcionalidad existente por diseño de fallback)

**🟡 Riesgo Medio:**
- Migración debe ejecutarse sin downtime (usar nullables para compatibilidad)
- Tests deben cubrir todas las combinaciones de modo (global/custom/disabled)

**🟢 Bajo Riesgo:**
- UI es aditivo, no modifica formularios existentes
- Lab sigue funcionando para control global (backward compatible)

---

## Alternativas Consideradas

### Alternativa 1: Solo horario en ENV (actual)
**Pros:** Simple, sin cambios
**Contras:** Todas las campañas comparten horario, no persiste, no auditable

### Alternativa 2: Horario por propiedad (no por campaña)
**Pros:** Menos campos en DB
**Contras:** Menos granular, una propiedad puede tener campañas con diferentes horarios

### Alternativa 3: Horario por campaña (propuesta)
**Pros:** Máxima flexibilidad, auditable, persiste en DB, fallback a global
**Contras:** Requiere migración y cambios en 5 archivos

**Recomendación:** ✅ Alternativa 3 (propuesta)

---

## Casos de Uso

### Caso 1: Propiedad en zona horaria diferente
**Escenario:** <PROPIEDAD_DEMO_A> (México) vs propiedad en California (USA)
**Solución:** Cada campaña configura su timezone y horario local

### Caso 2: Campaña urgente 24/7
**Escenario:** Black Friday - necesitan llamar en cualquier momento
**Solución:** Configurar campaña con mode="disabled" (24/7)

### Caso 3: Campaña legacy sin configuración
**Escenario:** Campaña creada antes de esta feature
**Solución:** `callWindowEnabled=null` → usa horario global de Lab/ENV

### Caso 4: Testing flexible
**Escenario:** Equipo de QA necesita probar fuera de horario
**Solución:** Lab sigue permitiendo override global para todas las campañas

---

## Checklist de Implementación

### Backend
- [ ] Migración Prisma con 6 campos nuevos
- [ ] `evaluateCampaignCallWindow()` en `call-window.ts`
- [ ] Actualizar endpoint GHL (línea 1308 webhooks.ts)
- [ ] Actualizar endpoint test-call (línea 2947 server.ts)
- [ ] Validación Zod para nuevos campos
- [ ] Tests unitarios para lógica de horario
- [ ] Build y verificar que compila

### Admin UI
- [ ] Agregar sección "Horario de Llamadas" al formulario
- [ ] Radio buttons: global/custom/disabled
- [ ] Campos custom: timezone, start/end hour, weekdays, apply to failover
- [ ] Validación frontend (start < end, al menos 1 día, etc.)
- [ ] Lógica de carga (de DB a UI)
- [ ] Lógica de guardado (de UI a payload)
- [ ] Probar en staging

### Docs
- [ ] Actualizar `ADMIN-GHL-CAMPAIGNS.md`
- [ ] Crear `CALL-WINDOW-MIGRATION.md`
- [ ] Agregar entrada en `CHANGELOG.md` (v0.4.0)
- [ ] Screenshot de nueva sección en Admin

### Testing
- [ ] Test: campaña con horario custom
- [ ] Test: campaña sin horario (usa global)
- [ ] Test: campaña 24/7
- [ ] Test: overnight window (22:00 → 06:00)
- [ ] Test: solo días laborables
- [ ] Test: diferentes timezones
- [ ] Test: failover con/sin aplicar horario

### Deploy
- [ ] Migración en staging
- [ ] Smoke test en staging
- [ ] Migración en production
- [ ] Anuncio al equipo de marketing

---

## Conclusión

**Complejidad:** 🟡 Media (2-3 días)

**Valor:** 🟢 Alto (flexibilidad por campaña, auditable, persiste)

**Recomendación:** ✅ **Vale la pena implementarlo**

El diseño propuesto es:
- ✅ Backward compatible (fallback a Lab/ENV)
- ✅ No rompe funcionalidad existente
- ✅ Permite granularidad máxima (por campaña)
- ✅ Fácil de testear (3 modos claros)
- ✅ Escalable (fácil agregar más campos después)

**Siguiente paso sugerido:**
Crear ticket en el backlog con estimación de 2-3 días y priorizar según necesidades del equipo.
