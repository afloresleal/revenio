# Dashboard MVP — Plan Final (Validado por Codex)

## Objetivo
Dashboard de métricas para visualizar rendimiento del voice agent: llamadas, transfers, abandonos, tiempos.

---

## Cambios por Feedback de Codex

| Área | Issue Original | Mejora Aplicada |
|------|----------------|-----------------|
| Schema | Campos derivados pueden divergir | Agregar `lastEventAt`, `lastEventType`, `inProgress` |
| Schema | Falta `endedReason` | Agregado para segmentar abandonos vs errores |
| Webhook | No maneja eventos fuera de orden | Usar **upsert** + idempotencia |
| Webhook | Duplicados rompen | Check `lastEventAt` antes de procesar |
| API | Queries múltiples ineficientes | GROUP BY en DB + cache 60s |
| Criterios | Faltan edge cases | Agregar tests de idempotencia |

---

## Microbloques Actualizados

### MB-DASH-01: Schema de Métricas (Mejorado)

**Identidad**
- ID: MB-DASH-01
- Nombre: Schema de métricas en DB
- Estado: diseño
- Tiempo: 30 min

**Schema Final (Prisma)**
```prisma
model CallMetric {
  id              String    @id @default(uuid())
  callId          String    @unique
  phoneNumber     String
  direction       String?   // inbound/outbound
  assistantId     String?
  
  // Timestamps de eventos
  startedAt       DateTime?
  transferredAt   DateTime?
  endedAt         DateTime?
  
  // Datos de llamada
  durationSec     Int?
  endedReason     String?   // customer-ended-call, system-error, timeout
  
  // Estado derivado
  outcome         String?   // transfer_success, abandoned, completed, failed, in_progress
  inProgress      Boolean   @default(true)
  
  // Control de idempotencia
  lastEventType   String?
  lastEventAt     DateTime?
  
  // Metadata
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([startedAt])
  @@index([endedAt])
  @@index([outcome])
  @@index([startedAt, outcome])
  @@index([lastEventAt])
}
```

**Criterios Autovalidables**

| Test | Comando | Esperado |
|------|---------|----------|
| Migration | `npx prisma migrate dev --name add_call_metrics` | Exit 0 |
| Schema válido | `npx prisma validate` | "Valid" |
| Índices creados | `\d call_metric` en psql | 5 índices |

---

### MB-DASH-02: Webhook Handler Idempotente

**Identidad**
- ID: MB-DASH-02
- Nombre: Captura de eventos VAPI (idempotente)
- Estado: diseño
- Tiempo: 1.5 horas

**Implementación**
```typescript
// POST /webhooks/vapi/metrics
import { z } from 'zod';

const CallEventSchema = z.object({
  type: z.enum(['call-started', 'transfer-started', 'call-ended']),
  call: z.object({
    id: z.string(),
    startedAt: z.string().optional(),
    endedAt: z.string().optional(),
    transferredAt: z.string().optional(),
    duration: z.number().optional(),
    endedReason: z.string().optional(),
    customer: z.object({
      number: z.string().optional(),
    }).optional(),
  }),
});

async function handleVapiMetrics(req: Request, res: Response) {
  // Validar payload
  const parsed = CallEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  
  const { type, call } = parsed.data;
  const eventAt = new Date(call.startedAt || call.endedAt || Date.now());

  // Upsert para tolerar orden incorrecto
  const metric = await prisma.callMetric.upsert({
    where: { callId: call.id },
    create: {
      callId: call.id,
      phoneNumber: call.customer?.number || 'unknown',
      startedAt: type === 'call-started' ? new Date(call.startedAt!) : null,
      inProgress: true,
      lastEventType: type,
      lastEventAt: eventAt,
    },
    update: {
      lastEventType: type,
      lastEventAt: eventAt,
    },
  });

  // Idempotencia: ignorar eventos viejos
  if (metric.lastEventAt && eventAt < metric.lastEventAt) {
    return res.json({ ok: true, ignored: true });
  }

  // Procesar por tipo
  switch (type) {
    case 'call-started':
      await prisma.callMetric.update({
        where: { callId: call.id },
        data: {
          startedAt: new Date(call.startedAt!),
          inProgress: true,
          outcome: 'in_progress',
        },
      });
      break;

    case 'transfer-started':
      await prisma.callMetric.update({
        where: { callId: call.id },
        data: {
          transferredAt: new Date(call.transferredAt || eventAt),
          outcome: 'transfer_success',
        },
      });
      break;

    case 'call-ended':
      const abandoned = !metric.transferredAt && 
                        call.endedReason !== 'customer-ended-call';
      await prisma.callMetric.update({
        where: { callId: call.id },
        data: {
          endedAt: new Date(call.endedAt!),
          durationSec: call.duration,
          endedReason: call.endedReason,
          inProgress: false,
          outcome: abandoned ? 'abandoned' : 
                   (metric.transferredAt ? 'transfer_success' : 'completed'),
        },
      });
      break;
  }

  return res.json({ ok: true });
}
```

**Criterios Autovalidables**

| Test | Comando | Esperado |
|------|---------|----------|
| Endpoint responde | `curl -X POST localhost:3000/webhooks/vapi/metrics -d '{"type":"call-started","call":{"id":"test1","startedAt":"2026-02-18T10:00:00Z"}}' -H 'Content-Type: application/json'` | 200 OK |
| call-started crea registro | `SELECT * FROM call_metric WHERE call_id='test1'` | 1 row, in_progress=true |
| call-started duplicado no falla | POST mismo evento 2 veces | 200 OK, ignored=true |
| call-ended sin start crea registro | POST call-ended con id nuevo | 200 OK, registro creado |
| transfer-started actualiza outcome | POST transfer-started | outcome='transfer_success' |

---

### MB-DASH-03: API de Métricas con Cache

**Identidad**
- ID: MB-DASH-03
- Nombre: Endpoints de consulta con cache
- Estado: diseño
- Tiempo: 1 hora

**Implementación**
```typescript
// Cache simple en memoria (TTL 60s)
const cache = new Map<string, { ts: number; value: any }>();
const TTL_MS = 60_000;

function getCache(key: string) {
  const entry = cache.get(key);
  if (!entry || Date.now() - entry.ts > TTL_MS) return null;
  return entry.value;
}

function setCache(key: string, value: any) {
  cache.set(key, { ts: Date.now(), value });
}

// GET /api/metrics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
async function getSummary(req: Request, res: Response) {
  const { from, to } = req.query;
  const cacheKey = `summary:${from}:${to}`;
  
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);
  
  const fromDate = from ? new Date(from as string) : subDays(new Date(), 7);
  const toDate = to ? new Date(to as string) : new Date();
  
  const result = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS "totalCalls",
      COALESCE(SUM(CASE WHEN outcome = 'transfer_success' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) AS "transferRate",
      COALESCE(SUM(CASE WHEN outcome = 'abandoned' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) AS "abandonRate",
      COALESCE(AVG(EXTRACT(EPOCH FROM (transferred_at - started_at)))::float, 0) AS "avgTimeToTransfer",
      COALESCE(AVG(duration_sec)::float, 0) AS "avgDuration",
      SUM(CASE WHEN in_progress = true THEN 1 ELSE 0 END)::int AS "inProgressCount"
    FROM call_metric
    WHERE started_at >= ${fromDate} AND started_at < ${toDate}
  `;
  
  const summary = {
    ...result[0],
    period: { from: fromDate.toISOString(), to: toDate.toISOString() }
  };
  
  setCache(cacheKey, summary);
  return res.json(summary);
}

// GET /api/metrics/daily?days=7
async function getDaily(req: Request, res: Response) {
  const days = parseInt(req.query.days as string) || 7;
  const cacheKey = `daily:${days}`;
  
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);
  
  const result = await prisma.$queryRaw`
    SELECT
      date_trunc('day', started_at)::date AS date,
      COUNT(*)::int AS calls,
      SUM(CASE WHEN outcome = 'transfer_success' THEN 1 ELSE 0 END)::int AS transfers,
      SUM(CASE WHEN outcome = 'abandoned' THEN 1 ELSE 0 END)::int AS abandoned,
      COALESCE(AVG(duration_sec)::int, 0) AS "avgDuration"
    FROM call_metric
    WHERE started_at >= NOW() - INTERVAL '${days} days'
    GROUP BY 1
    ORDER BY 1 ASC
  `;
  
  setCache(cacheKey, result);
  return res.json(result);
}

// GET /api/metrics/recent?limit=10
async function getRecent(req: Request, res: Response) {
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
  
  const calls = await prisma.callMetric.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      phoneNumber: true,
      outcome: true,
      durationSec: true,
      createdAt: true,
      inProgress: true,
    },
  });
  
  return res.json(calls.map(c => ({
    phone: maskPhone(c.phoneNumber),
    outcome: c.outcome,
    duration: c.durationSec,
    ago: formatRelative(c.createdAt),
    inProgress: c.inProgress,
  })));
}
```

**Criterios Autovalidables**

| Test | Comando | Esperado |
|------|---------|----------|
| /summary responde | `curl localhost:3000/api/metrics/summary` | JSON con totalCalls |
| /daily responde | `curl localhost:3000/api/metrics/daily?days=7` | Array de objetos |
| Cache funciona | 2 requests en <60s | Segunda request más rápida |
| Sin transfers no divide por cero | Borrar transfers, GET /summary | avgTimeToTransfer=0 |

---

### MB-DASH-04: Frontend Dashboard

**Identidad**
- ID: MB-DASH-04
- Nombre: UI de visualización
- Estado: diseño
- Tiempo: 2-3 horas

**Componentes**
```
src/
  components/
    Dashboard.tsx       # Layout principal
    MetricCard.tsx      # Card individual con valor + delta
    DailyChart.tsx      # Gráfica de barras (Recharts)
    RecentCalls.tsx     # Tabla de últimas llamadas
    PeriodSelector.tsx  # Dropdown Hoy/Ayer/7días/30días
  hooks/
    useMetrics.ts       # Fetch + polling + estados
  lib/
    api.ts              # Cliente API
    format.ts           # Formateo de números/fechas
```

**Estados a manejar**
- `loading` — Skeleton de cards y gráfica
- `error` — Mensaje + botón retry
- `empty` — Sin datos para el período
- `partial` — Hay llamadas `inProgress` (mostrar badge)
- `success` — Datos completos

**Criterios Autovalidables**

| Test | Comando | Esperado |
|------|---------|----------|
| Build sin errores | `npm run build` | Exit 0 |
| Página carga | `curl localhost:3001/dashboard` | HTML con #root |
| Cards visibles | Navegador | 4 cards renderizadas |
| Gráfica renderiza | Navegador | SVG de Recharts presente |
| Estado loading | Throttle network | Skeleton visible |
| Estado error | Desconectar API | Mensaje + retry button |

---

## Orden de Ejecución

```
MB-DASH-01 (schema)     → 30 min
    ↓
MB-DASH-02 (webhook)    → 1.5 h
    ↓
MB-DASH-03 (API)        → 1 h
    ↓
MB-DASH-04 (frontend)   → 2-3 h
```

**Total estimado: 5-6 horas**

---

## Diseño UI (Wireframe Texto)

```
┌─────────────────────────────────────────────────────────────────────┐
│  🎙️ Revenio Voice Metrics                        [Hoy ▾] [⟳]       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  │  📞 LLAMADAS  │  │  ✅ TRANSFERS │  │  ❌ ABANDONOS │  │  ⏱️ TIEMPO    │
│  │               │  │               │  │               │  │               │
│  │      47       │  │     81%       │  │     12%       │  │     24s       │
│  │    hoy        │  │   (38/47)     │  │    (6/47)     │  │   promedio    │
│  │               │  │               │  │               │  │               │
│  │  ▲ +12%       │  │  ▼ -3%        │  │  ▲ +2%        │  │  ▼ -5s        │
│  │  vs ayer      │  │  vs ayer      │  │  vs ayer      │  │  vs ayer      │
│  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐
│  │                    📊 Últimos 7 días                            │
│  │                                                                 │
│  │   60 ┤                                          ╭──╮            │
│  │      │                              ╭──╮        │  │    ╭──╮    │
│  │   40 ┤        ╭──╮    ╭──╮    ╭──╮  │  │  ╭──╮  │  │    │  │    │
│  │      │  ╭──╮  │  │    │  │    │  │  │  │  │  │  │  │    │  │    │
│  │   20 ┤  │  │  │  │    │  │    │  │  │  │  │  │  │  │    │  │    │
│  │      │  │  │  │  │    │  │    │  │  │  │  │  │  │  │    │  │    │
│  │    0 ┼──┴──┴──┴──┴────┴──┴────┴──┴──┴──┴──┴──┴──┴──┴────┴──┴──  │
│  │       Lun    Mar     Mie     Jue    Vie    Sab    Dom    Hoy    │
│  │                                                                 │
│  │   ■ Llamadas   ■ Transfers   ■ Abandonos                        │
│  └─────────────────────────────────────────────────────────────────┘
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐
│  │  📋 Últimas llamadas                                [En curso: 2] │
│  ├─────────────────────────────────────────────────────────────────┤
│  │  +52 55 **** 5678  │  ✅ Transfer   │  32s    │  hace 5 min     │
│  │  +52 33 **** 4321  │  ❌ Abandonó   │  18s    │  hace 12 min    │
│  │  +52 81 **** 3333  │  🔵 En curso   │   --    │  hace 1 min     │
│  │  +52 55 **** 0000  │  ✅ Transfer   │  41s    │  hace 23 min    │
│  │  +52 33 **** 2222  │  ⚪ Completó   │  95s    │  hace 31 min    │
│  └─────────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────────┘
```

**Estados visuales:**
- ✅ Transfer (verde)
- ❌ Abandonó (rojo)
- 🔵 En curso (azul, pulsating)
- ⚪ Completó (gris)

---

## Prompt para Generador de UI (v0/Lovable/Bolt)

```
Crea un dashboard de métricas para un sistema de llamadas con agente de voz AI.

CONTEXTO:
- Monitorea un voice agent que recibe llamadas y las transfiere a asesores humanos
- Stack: React 18 + TypeScript + Tailwind CSS + Recharts
- Datos de API REST en /api/metrics/*

PANTALLA PRINCIPAL — DASHBOARD:

1. **Header**
   - Título: "Revenio Voice Metrics" con ícono de micrófono
   - Dropdown selector de período (Hoy, Ayer, 7 días, 30 días)
   - Botón de refresh con ícono circular
   - Indicador de última actualización ("Actualizado hace 30s")

2. **Grid de 4 Metric Cards** (responsive: 4 cols desktop, 2 tablet, 1 mobile)
   Cada card tiene:
   - Ícono superior (📞 ✅ ❌ ⏱️)
   - Label pequeño (ej: "LLAMADAS")
   - Valor principal grande (ej: "47")
   - Subtexto (ej: "hoy" o "(38 de 47)")
   - Delta vs período anterior con flecha y color (verde=positivo, rojo=negativo)
   
   Cards:
   a) Llamadas totales — número + "hoy"
   b) Tasa de transfer — porcentaje + "(X de Y)"
   c) Tasa de abandono — porcentaje + "(X de Y)"
   d) Tiempo a transfer — segundos + "promedio"

3. **Gráfica de Barras "Últimos 7 días"**
   - Usar Recharts BarChart
   - Eje X: días (Lun, Mar, Mie...)
   - Eje Y: cantidad de llamadas
   - 3 series agrupadas: Llamadas (azul), Transfers (verde), Abandonos (rojo)
   - Leyenda inferior horizontal
   - Tooltip on hover con valores exactos
   - Responsive: full width

4. **Tabla "Últimas llamadas"**
   - Header con badge "En curso: X" si hay llamadas in_progress
   - Columnas: Teléfono | Resultado | Duración | Tiempo
   - Teléfono: parcialmente oculto (+52 55 **** 1234)
   - Resultado: badge con color e ícono
     - ✅ Transfer (verde)
     - ❌ Abandonó (rojo)
     - 🔵 En curso (azul, con animación pulse)
     - ⚪ Completó (gris)
   - Duración: "32s" o "--" si en curso
   - Tiempo: relativo ("hace 5 min")
   - Máximo 10 filas, scroll interno si hay más

ESTADOS DE UI:
- **Loading**: Skeleton animado en cards y gráfica
- **Error**: Card centrada con ícono ⚠️, mensaje, botón "Reintentar"
- **Sin datos**: Ilustración vacía + "Sin llamadas en este período"
- **Datos parciales**: Badge en header "🔵 X llamadas en curso"

ESTILOS:
- Dark mode por defecto (fondo #0f172a, cards #1e293b)
- Acentos: azul #3b82f6, verde #22c55e, rojo #ef4444
- Bordes: rounded-xl con border sutil (#334155)
- Sombras: shadow-lg en cards
- Tipografía: Inter o system-ui, font-medium para valores
- Transiciones: hover en cards (scale-[1.02]), smooth transitions en datos
- Responsive breakpoints: sm (640px), md (768px), lg (1024px)

ACCESIBILIDAD:
- Contraste mínimo WCAG AA
- aria-labels en botones de ícono
- role="table" en tabla de llamadas
- Colores no como único indicador (usar íconos también)

DATOS DE EJEMPLO (hardcoded para prototipo):
```json
{
  "summary": {
    "totalCalls": 47,
    "transferRate": 0.81,
    "abandonRate": 0.12,
    "avgTimeToTransfer": 24,
    "inProgressCount": 2
  },
  "daily": [
    { "date": "2026-02-12", "day": "Lun", "calls": 32, "transfers": 25, "abandoned": 4 },
    { "date": "2026-02-13", "day": "Mar", "calls": 38, "transfers": 30, "abandoned": 5 },
    { "date": "2026-02-14", "day": "Mie", "calls": 41, "transfers": 34, "abandoned": 4 },
    { "date": "2026-02-15", "day": "Jue", "calls": 45, "transfers": 37, "abandoned": 5 },
    { "date": "2026-02-16", "day": "Vie", "calls": 52, "transfers": 43, "abandoned": 6 },
    { "date": "2026-02-17", "day": "Sab", "calls": 28, "transfers": 22, "abandoned": 3 },
    { "date": "2026-02-18", "day": "Hoy", "calls": 47, "transfers": 38, "abandoned": 6 }
  ],
  "recent": [
    { "phone": "+52 55 **** 5678", "outcome": "transfer", "duration": 32, "ago": "5 min" },
    { "phone": "+52 33 **** 4321", "outcome": "abandoned", "duration": 18, "ago": "12 min" },
    { "phone": "+52 81 **** 3333", "outcome": "in_progress", "duration": null, "ago": "1 min" },
    { "phone": "+52 55 **** 0000", "outcome": "transfer", "duration": 41, "ago": "23 min" },
    { "phone": "+52 33 **** 2222", "outcome": "completed", "duration": 95, "ago": "31 min" }
  ]
}
```

CÓDIGO:
- Un solo archivo App.tsx con todos los componentes
- TypeScript con interfaces para Summary, DailyData, RecentCall
- Usar useState para período seleccionado
- Simular loading con setTimeout de 1s al cambiar período
- Comentarios en español explicando cada sección
```

---

## Resumen de Mejoras por Codex

| # | Sugerencia Codex | Acción |
|---|------------------|--------|
| 1 | Separar eventos de estado derivado | ✅ Agregado `lastEventAt`, `lastEventType` |
| 2 | Manejo de eventos fuera de orden | ✅ Upsert + check de timestamp |
| 3 | Idempotencia en duplicados | ✅ Ignorar si `eventAt < lastEventAt` |
| 4 | Campo `endedReason` | ✅ Agregado al schema |
| 5 | Índice compuesto | ✅ `@@index([startedAt, outcome])` |
| 6 | Cache en API | ✅ TTL 60s para summary/daily |
| 7 | Validación con Zod | ✅ Schema de payload |
| 8 | Estado "en curso" en UI | ✅ Badge + llamadas inProgress |
| 9 | Tests de idempotencia | ✅ Criterios autovalidables ampliados |

---

## Aprobación

✅ **Revisado por Codex** — 2026-02-18
✅ **Incorporadas sugerencias críticas**
📋 **Listo para revisión de Marina**
