# Revisión técnica — Dashboard MVP

Primero, gracias por el plan: está claro, operativo y con un buen nivel de detalle para un MVP. A continuación dejo una revisión técnica específica, con riesgos, mejoras y ejemplos de código.

**Fecha de revisión:** 2026-02-18

---

## 1) Prisma Schema — Cobertura de outcomes y campos faltantes

**Hallazgos**
- El modelo `CallMetric` cubre outcomes básicos, pero **mezcla campos derivados (abandoned/transferred/outcome)** con hechos de evento. Esto puede llevar a inconsistencias si llegan eventos fuera de orden.
- Falta **persistir el último evento recibido y/o versión** para idempotencia.
- Falta **normalizar timestamps de eventos** (`startedAt`, `transferredAt`, `endedAt`) con la **zona horaria / fuente de tiempo** (idealmente `call.startedAt` y `call.endedAt` del payload, no `new Date()` del servidor).
- Faltan campos útiles para diagnósticos y agregaciones: `endedReason`, `transferType`, `agentId`, `assistantId`, `direction`, `customerCountry`, `errorCode`, `recordingUrl` (si existe), `campaignId` o `source`.
- No hay control explícito de **eventos duplicados** ni **evento parcial** (ej. call-started duplicado) ni **llamada sin start**.

**Sugerencias concretas**
- Separar **hechos de evento** vs **estado derivado**. Guardar timestamps de eventos y computar outcomes en el handler o en agregaciones, pero evitar campos redundantes que puedan divergir.
- Guardar **`lastEventAt`** y **`lastEventType`** para ordenar eventos y para idempotencia.
- Añadir **`endedReason`** y **`transferedReason`** (si el proveedor lo da) para segmentar abandono vs fallo vs completado.
- Guardar `callDurationMs` o `durationSec` de manera consistente.

**Ejemplo de schema mejorado (mínimo viable):**

```prisma
model CallMetric {
  id              String   @id @default(uuid())
  callId          String   @unique
  phoneNumber     String
  direction       String?  // inbound/outbound
  agentId         String?
  assistantId     String?
  startedAt       DateTime?
  transferredAt   DateTime?
  endedAt         DateTime?
  durationSec     Int?
  endedReason     String?  // customer-ended-call, system-error, timeout...
  outcome         String?  // transfer_success, abandoned, completed, failed
  inProgress      Boolean  @default(true)
  lastEventType   String?
  lastEventAt     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([startedAt])
  @@index([endedAt])
  @@index([outcome])
  @@index([lastEventAt])
}
```

---

## 2) Webhook Handler — Edge cases

**Edge cases actuales no cubiertos**
- **call-ended sin call-started**: el `update` fallará (record not found). Esto es realista con reintentos, orden aleatorio o pérdida de eventos.
- **eventos duplicados**: `create` de call-started fallará por `callId` unique; no se maneja idempotencia.
- **orden incorrecto**: `transfer-started` antes de `call-started` hará update fallido.
- **timestamps inconsistentes**: para `transfer-started` se usa `new Date()` en lugar de `call.transferredAt` (si existe).
- **race conditions**: dos eventos simultáneos pueden pisarse (ej. end + transfer).

**Sugerencias concretas**
- Usar **upsert** o `create` con manejo de errores por `UniqueConstraint`.
- Persistir el **tipo y timestamp del último evento** para descartar duplicados o eventos más viejos.
- Emplear una estrategia **idempotente**: `if lastEventAt >= incomingEventAt, ignore`.
- Usar `call.*At` del payload cuando exista.
- Si el proveedor entrega `eventId`, persistirlo y hacer dedupe por `(callId, eventId)`.

**Ejemplo de handler robusto (resumen):**

```ts
async function handleVapiMetrics(req, res) {
  const { type, call, eventId } = req.body;
  const eventAt = new Date(call?.timestamp || call?.endedAt || call?.startedAt || Date.now());

  // Upsert mínimo para tolerar orden incorrecto
  const base = {
    callId: call.id,
    phoneNumber: call.customer?.number || 'unknown',
    lastEventType: type,
    lastEventAt: eventAt,
  };

  const metric = await prisma.callMetric.upsert({
    where: { callId: call.id },
    create: {
      ...base,
      startedAt: type === 'call-started' ? new Date(call.startedAt) : null,
      inProgress: true,
    },
    update: {
      // idempotencia simple
      lastEventType: type,
      lastEventAt: eventAt,
    },
  });

  // Si llega un evento viejo, no sobrescribir
  if (metric.lastEventAt && eventAt < metric.lastEventAt) {
    return res.json({ ok: true, ignored: true });
  }

  if (type === 'call-started') {
    await prisma.callMetric.update({
      where: { callId: call.id },
      data: { startedAt: new Date(call.startedAt), inProgress: true },
    });
  }

  if (type === 'transfer-started') {
    await prisma.callMetric.update({
      where: { callId: call.id },
      data: {
        transferredAt: new Date(call.transferredAt || eventAt),
        outcome: 'transfer_success',
      },
    });
  }

  if (type === 'call-ended') {
    const abandoned = !metric.transferredAt && call.endedReason !== 'customer-ended-call';
    await prisma.callMetric.update({
      where: { callId: call.id },
      data: {
        endedAt: new Date(call.endedAt),
        durationSec: call.duration,
        endedReason: call.endedReason,
        inProgress: false,
        outcome: abandoned
          ? 'abandoned'
          : metric.transferredAt
            ? 'transfer_success'
            : 'completed',
      },
    });
  }

  return res.json({ ok: true });
}
```

---

## 3) API Agregaciones — Eficiencia e índices

**Observaciones**
- Para dashboards en tiempo real, hacer múltiples `COUNT`/`AVG` por request puede escalar mal si la tabla crece rápido.
- Falta **índice compuesto** por `startedAt` y `outcome` para filtros por rango + outcome.
- Falta controlar `from/to` por **zona horaria** y redondeo a día.
- El endpoint de `/daily` no especifica cómo se agregan datos con huecos (días sin llamadas).

**Recomendaciones**
- Agregar índices: `@@index([startedAt, outcome])`, `@@index([endedAt])`.
- Incluir un endpoint de agregación que **haga un solo query con group by** en DB (PostgreSQL) para los diarios.
- Cachear resultados de `summary` con **TTL corto (30-60s)** si hay alto volumen.

**Ejemplo SQL eficiente para daily (Postgres):**

```sql
SELECT
  date_trunc('day', started_at) AS day,
  COUNT(*) AS calls,
  SUM(CASE WHEN outcome = 'transfer_success' THEN 1 ELSE 0 END) AS transfers,
  SUM(CASE WHEN outcome = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
  AVG(duration_sec) AS avg_duration
FROM call_metric
WHERE started_at >= $1 AND started_at < $2
GROUP BY 1
ORDER BY 1 ASC;
```

**Cache simple (Express)**

```ts
const cache = new Map();
const TTL_MS = 60_000;

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) return null;
  return entry.value;
}

function setCache(key, value) {
  cache.set(key, { ts: Date.now(), value });
}
```

---

## 4) Diseño UI — Implementabilidad y estados

**Implementable** con React + Recharts + Tailwind. Sí.

**Faltan estados importantes**
- **Estado de "sin datos para el período"** sí está, pero falta **estado de "datos parciales"** (cuando hay calls sin ended).
- Falta **estado de "loading incremental"** para refresco (no bloquear toda la UI si llega una respuesta nueva).
- Falta **estado de "filtro inválido"** si from > to o rango fuera de permitido.

**Prompt de AI generator**
- Es bastante completo. Solo faltan:
  - Comportamiento para **timezones** (ej. mostrar fecha local del usuario o del call center).
  - **Manejo de datos parciales** (ej. inProgress). Sugerir badge “En curso”.
  - Un criterio de **accesibilidad mínima** (contraste de colores y texto alternativo).

---

## 5) Métricas faltantes

**Importantes para voice agent:**
- **Tiempo promedio a contestar (pickup)** si existe evento `call-answered`.
- **Tasa de fallo / error** (endedReason = system-error, timeout, busy).
- **Tasa de llamadas en curso** (inProgress true) para operacional.
- **Distribución de duración** (p50/p90) para detectar outliers.
- **Conversion rate por transfer** (si transfer termina en éxito).
- **Calls by hour** para carga operativa.

---

## 6) Criterios autovalidables — Cobertura

**Observaciones**
- Son simples y ejecutables, pero faltan casos de **idempotencia** y **orden incorrecto**.
- No validan agregaciones ni datos parciales.

**Sugerencias**
- Agregar criterios:
  - `call-ended` antes de `call-started` debe crear/actualizar registro sin error.
  - `call-started` duplicado no debe romper (idempotente).
  - `transfer-started` duplicado no debe duplicar resultado.
  - `summary` devuelve `avgTimeToTransfer` sólo cuando hay transfers (evitar dividir por cero).

---

## 7) Sugerencias adicionales

1. **Agregar un modelo `CallEvent` opcional** para auditar eventos y soportar debugging.
2. **Separar métricas derivadas** (cálculos) de datos crudos.
3. **Definir claramente el timezone** para aggregaciones diarias.
4. **Validar payloads** con zod/yup antes de persistir.
5. **Implementar un esquema de reintento seguro** (idempotencia real).

**Ejemplo de payload validation (zod):**

```ts
const CallEventSchema = z.object({
  type: z.enum(['call-started', 'transfer-started', 'call-ended']),
  call: z.object({
    id: z.string(),
    startedAt: z.string().optional(),
    endedAt: z.string().optional(),
    duration: z.number().optional(),
    endedReason: z.string().optional(),
    customer: z.object({
      number: z.string().optional(),
    }).optional(),
  }),
});
```

---

# Conclusión

El plan es sólido para un MVP, pero hay riesgos concretos en la ingestión de eventos (orden, duplicados, faltantes) y en el modelado (campos derivados que se pueden desincronizar). Con pequeñas mejoras en schema, handler idempotente y agregaciones, se vuelve robusto y escalable para dashboards en tiempo real.

Si quieres, puedo convertir estas sugerencias en tareas de implementación concretas con estimación.
