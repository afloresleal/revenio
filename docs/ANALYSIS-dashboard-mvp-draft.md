# Dashboard MVP — Plan de Trabajo

## Objetivo
Dashboard de métricas para visualizar rendimiento del voice agent: llamadas, transfers, abandonos, tiempos.

## Métricas Core

| Métrica | Fuente | Cálculo |
|---------|--------|---------|
| Llamadas totales | `call-started` webhook | COUNT por día |
| Tasa de transfer | `transfer-started` / `call-started` | % |
| Tiempo a transfer | `transfer-started.timestamp` - `call-started.timestamp` | segundos |
| Abandonos | Llamadas sin transfer ni end normal | % |
| Duración promedio | `call-ended.duration` | AVG minutos |

---

## Microbloques

### MB-DASH-01: Schema de Métricas

**Identidad**
- ID: MB-DASH-01
- Nombre: Schema de métricas en DB
- Estado: diseño

**Propósito de Negocio**
- Pregunta que responde: ¿Cómo estructurar datos para consultas rápidas de métricas?
- Decisión que habilita: Queries eficientes por rango de fechas
- Riesgo que reduce: Consultas lentas en producción
- Costo de no tenerlo: Reimplementar schema después

**Rol Cognitivo:** Analista

**Tech Stack**
- Prisma (ya en uso)
- PostgreSQL
- Modelo `CallMetric` con campos agregados

**Dependencias**
- Depende de: Schema Prisma existente
- Quién depende: MB-DASH-02, MB-DASH-03

**Criterios Autovalidables**

| Nombre | Tipo | Comando | Resultado esperado |
|--------|------|---------|-------------------|
| Migration corre | DB | `npx prisma migrate dev` | Exit 0, tabla creada |
| Schema válido | DB | `npx prisma validate` | "Valid" |
| Modelo accesible | API | `npx prisma studio` | Tabla visible |

**Scope**
```prisma
model CallMetric {
  id            String   @id @default(uuid())
  callId        String   @unique
  phoneNumber   String
  startedAt     DateTime
  endedAt       DateTime?
  duration      Int?     // segundos
  transferredAt DateTime?
  transferred   Boolean  @default(false)
  abandoned     Boolean  @default(false)
  outcome       String?  // "transfer_success", "abandoned", "completed", "failed"
  createdAt     DateTime @default(now())
  
  @@index([startedAt])
  @@index([outcome])
}
```

---

### MB-DASH-02: Webhook Handler para Métricas

**Identidad**
- ID: MB-DASH-02
- Nombre: Captura de eventos VAPI en CallMetric
- Estado: diseño

**Propósito de Negocio**
- Pregunta que responde: ¿Cómo transformar webhooks en métricas?
- Decisión que habilita: Datos en tiempo real
- Riesgo que reduce: Pérdida de eventos
- Costo de no tenerlo: Sin datos para dashboard

**Rol Cognitivo:** Ejecutor

**Tech Stack**
- Express.js (existente en Revenio)
- Prisma Client
- Endpoint `/webhooks/vapi/metrics`

**Dependencias**
- Depende de: MB-DASH-01 (schema)
- Quién depende: MB-DASH-03 (API)

**Criterios Autovalidables**

| Nombre | Tipo | Comando | Resultado esperado |
|--------|------|---------|-------------------|
| Endpoint responde | API | `curl -X POST localhost:3000/webhooks/vapi/metrics -d '{"type":"call-started"}' -H 'Content-Type: application/json'` | 200 OK |
| call-started crea registro | DB | Query `SELECT * FROM CallMetric WHERE callId='test'` | 1 row |
| transfer-started actualiza | DB | POST transfer-started, query transferred=true | true |
| call-ended completa | DB | POST call-ended, query duration IS NOT NULL | valor presente |

**Scope**
```typescript
// POST /webhooks/vapi/metrics
async function handleVapiMetrics(req, res) {
  const { type, call } = req.body;
  
  switch(type) {
    case 'call-started':
      await prisma.callMetric.create({
        data: {
          callId: call.id,
          phoneNumber: call.customer?.number || 'unknown',
          startedAt: new Date(call.startedAt),
          outcome: 'in_progress'
        }
      });
      break;
      
    case 'transfer-started':
      await prisma.callMetric.update({
        where: { callId: call.id },
        data: {
          transferredAt: new Date(),
          transferred: true,
          outcome: 'transfer_success'
        }
      });
      break;
      
    case 'call-ended':
      const metric = await prisma.callMetric.findUnique({ where: { callId: call.id }});
      const abandoned = !metric?.transferred && call.endedReason !== 'customer-ended-call';
      
      await prisma.callMetric.update({
        where: { callId: call.id },
        data: {
          endedAt: new Date(call.endedAt),
          duration: call.duration,
          abandoned,
          outcome: abandoned ? 'abandoned' : (metric?.transferred ? 'transfer_success' : 'completed')
        }
      });
      break;
  }
  
  res.json({ ok: true });
}
```

---

### MB-DASH-03: API de Métricas Agregadas

**Identidad**
- ID: MB-DASH-03
- Nombre: Endpoints de consulta de métricas
- Estado: diseño

**Propósito de Negocio**
- Pregunta que responde: ¿Cuál es el rendimiento del agente hoy/esta semana?
- Decisión que habilita: Visualización en dashboard
- Riesgo que reduce: Queries complejas en frontend
- Costo de no tenerlo: Frontend hace cálculos pesados

**Rol Cognitivo:** Analista

**Tech Stack**
- Express.js
- Prisma aggregations
- Endpoints REST

**Dependencias**
- Depende de: MB-DASH-01, MB-DASH-02
- Quién depende: MB-DASH-04 (frontend)

**Criterios Autovalidables**

| Nombre | Tipo | Comando | Resultado esperado |
|--------|------|---------|-------------------|
| /metrics/summary responde | API | `curl localhost:3000/api/metrics/summary` | JSON con totalCalls, transferRate, etc |
| /metrics/daily responde | API | `curl localhost:3000/api/metrics/daily?days=7` | Array de 7 objetos |
| Filtro por fecha funciona | API | `curl localhost:3000/api/metrics/summary?from=2026-02-01&to=2026-02-18` | Datos filtrados |

**Scope**
```typescript
// GET /api/metrics/summary
// Query params: from, to (ISO dates)
{
  "totalCalls": 147,
  "transferRate": 0.81,
  "abandonRate": 0.12,
  "avgTimeToTransfer": 24.5,  // segundos
  "avgDuration": 138.2,       // segundos
  "period": {
    "from": "2026-02-11",
    "to": "2026-02-18"
  }
}

// GET /api/metrics/daily?days=7
[
  { "date": "2026-02-18", "calls": 47, "transfers": 38, "abandoned": 6, "avgDuration": 145 },
  { "date": "2026-02-17", "calls": 52, "transfers": 44, "abandoned": 5, "avgDuration": 132 },
  ...
]
```

---

### MB-DASH-04: Frontend Dashboard

**Identidad**
- ID: MB-DASH-04
- Nombre: UI de visualización de métricas
- Estado: diseño

**Propósito de Negocio**
- Pregunta que responde: ¿Cómo está funcionando el agente de un vistazo?
- Decisión que habilita: Detectar problemas rápidamente
- Riesgo que reduce: Operar a ciegas
- Costo de no tenerlo: Revisar logs manualmente

**Rol Cognitivo:** Observador

**Tech Stack**
- React (Revenio Lab ya usa esto)
- Recharts para gráficas
- Tailwind CSS
- Fetch a /api/metrics/*

**Dependencias**
- Depende de: MB-DASH-03 (API)
- Quién depende: Usuarios finales

**Criterios Autovalidables**

| Nombre | Tipo | Comando | Resultado esperado |
|--------|------|---------|-------------------|
| Build sin errores | UI | `npm run build` | Exit 0 |
| Página carga | UI | `curl localhost:3001/dashboard` | HTML con root div |
| Fetch funciona | UI | Browser DevTools Network | 200 en /api/metrics/summary |
| Cards visibles | UI | Screenshot/visual | 4 cards con métricas |
| Gráfica renderiza | UI | Screenshot/visual | Chart con 7 días |

**Scope**
Ver sección "Diseño UI" abajo.

---

## Orden de Ejecución

```
MB-DASH-01 (schema)
    ↓
MB-DASH-02 (webhook handler)
    ↓
MB-DASH-03 (API agregaciones)
    ↓
MB-DASH-04 (frontend)
```

**Tiempo estimado total:** 4-6 horas

| Microbloque | Tiempo |
|-------------|--------|
| MB-DASH-01 | 30 min |
| MB-DASH-02 | 1 hora |
| MB-DASH-03 | 1 hora |
| MB-DASH-04 | 2-3 horas |

---

## Diseño UI (Text Wireframe)

### Pantalla Principal: Dashboard

```
┌─────────────────────────────────────────────────────────────────────┐
│  🎙️ Revenio Voice Metrics                        [Hoy ▾] [⟳ Refresh] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  │  📞 LLAMADAS │  │  ✅ TRANSFER │  │  ❌ ABANDONOS│  │  ⏱️ TIEMPO   │
│  │              │  │              │  │              │  │              │
│  │     47       │  │    81%       │  │    12%       │  │    24s       │
│  │   hoy        │  │  (38 de 47)  │  │   (6 de 47)  │  │  promedio    │
│  │              │  │              │  │              │  │              │
│  │  ↑ 12% vs    │  │  ↓ 3% vs     │  │  ↑ 2% vs     │  │  ↓ 5s vs     │
│  │  ayer        │  │  ayer        │  │  ayer        │  │  ayer        │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐
│  │                    Últimos 7 días                               │
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
│  │  📋 Últimas llamadas                                            │
│  ├─────────────────────────────────────────────────────────────────┤
│  │  <PHONE_E164>  │  ✅ Transfer  │  32s  │  hace 5 min        │
│  │  <PHONE_E164>  │  ❌ Abandonó  │  18s  │  hace 12 min       │
│  │  <PHONE_E164>  │  ✅ Transfer  │  28s  │  hace 15 min       │
│  │  <PHONE_E164>  │  ✅ Transfer  │  41s  │  hace 23 min       │
│  │  <PHONE_E164>  │  ⚪ Completó  │  95s  │  hace 31 min       │
│  └─────────────────────────────────────────────────────────────────┘
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Componentes

**1. Header**
- Logo/título
- Selector de período (Hoy, Ayer, 7 días, 30 días, Custom)
- Botón refresh

**2. Metric Cards (4)**
- Llamadas totales con delta vs período anterior
- Tasa de transfer con delta
- Tasa de abandono con delta
- Tiempo promedio a transfer con delta

**3. Chart Area**
- Bar chart con 3 series (llamadas, transfers, abandonos)
- Eje X: días
- Eje Y: conteo
- Leyenda inferior

**4. Recent Calls Table**
- Número (parcialmente oculto por privacidad)
- Outcome con icono/color
- Duración
- Tiempo relativo

### Estados

**Loading:**
```
┌──────────────┐
│  ░░░░░░░░░░  │
│  Cargando... │
└──────────────┘
```

**Sin datos:**
```
┌──────────────────────────────────┐
│  📭 Sin llamadas en este período │
│  Ajusta el filtro de fechas      │
└──────────────────────────────────┘
```

**Error:**
```
┌──────────────────────────────────┐
│  ⚠️ Error al cargar métricas     │
│  [Reintentar]                    │
└──────────────────────────────────┘
```

---

## Prompt para Generador de UI (v0/Lovable/Bolt)

```
Crea un dashboard de métricas para un sistema de llamadas telefónicas con agente de voz.

CONTEXTO:
- Es para monitorear un voice agent que recibe llamadas y las transfiere a asesores humanos
- Stack: React + Tailwind CSS + Recharts
- Datos vienen de API REST

PANTALLA PRINCIPAL:
1. Header con título "Revenio Voice Metrics", selector de período (dropdown: Hoy/Ayer/7 días/30 días), botón refresh

2. Fila de 4 cards de métricas:
   - Llamadas totales (número grande + delta % vs período anterior)
   - Tasa de transfer (% + número absoluto ej: "81% (38 de 47)")
   - Tasa de abandono (% + número absoluto)
   - Tiempo promedio a transfer (en segundos)
   Cada card con icono, valor principal grande, comparación con período anterior (flecha arriba/abajo + color verde/rojo)

3. Gráfica de barras "Últimos 7 días":
   - Eje X: días de la semana
   - Eje Y: cantidad
   - 3 series: Llamadas (azul), Transfers (verde), Abandonos (rojo)
   - Leyenda inferior
   - Usar Recharts BarChart

4. Tabla "Últimas llamadas":
   - Columnas: Teléfono (parcialmente oculto), Resultado (con badge de color), Duración, Hace cuánto
   - Resultados posibles: Transfer (verde), Abandonó (rojo), Completó (gris)
   - Máximo 10 filas, scroll si hay más

ESTILOS:
- Dark mode por defecto
- Colores: fondo #0f172a, cards #1e293b, acentos azul #3b82f6
- Bordes redondeados (rounded-xl)
- Sombras sutiles
- Tipografía: Inter o system-ui
- Responsive (stack vertical en móvil)

DATOS DE EJEMPLO:
{
  "summary": {
    "totalCalls": 47,
    "transferRate": 0.81,
    "abandonRate": 0.12,
    "avgTimeToTransfer": 24
  },
  "daily": [
    { "date": "2026-02-18", "calls": 47, "transfers": 38, "abandoned": 6 },
    { "date": "2026-02-17", "calls": 42, "transfers": 35, "abandoned": 4 }
  ],
  "recent": [
    { "phone": "+52 55 **** 5678", "outcome": "transfer", "duration": 32, "ago": "5 min" }
  ]
}

CÓDIGO:
- Componente funcional React
- Hooks: useState, useEffect para fetch
- Crear componentes: MetricCard, DailyChart, RecentCallsTable
- Manejar estados: loading, error, success
- API base URL como prop o env var
```

---

## Para Validación Codex

Revisar:
1. ¿Schema de Prisma cubre todos los casos de outcome?
2. ¿Webhook handler maneja edge cases (llamada sin call-started previo)?
3. ¿API de agregaciones es eficiente para consultas frecuentes?
4. ¿Diseño de UI es implementable con el stack propuesto?
5. ¿Faltan métricas importantes?
6. ¿Criterios autovalidables son suficientes y ejecutables?
