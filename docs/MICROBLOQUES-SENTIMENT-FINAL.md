# Microbloques V2: Sentiment Badge + Filtros (Iterado con Codex)

## Cambios vs V1

| Issue Codex | Acción |
|-------------|--------|
| `durationSec=0` tratado como falsy | ✅ Usar `!== null` en lugar de truthiness |
| Falta plan de backfill | ✅ Agregado script de backfill |
| Inconsistencia `transfer` vs `transfer_success` | ✅ Alineado a `transfer_success` |
| Falta índice combinado | ✅ Agregado `@@index([sentiment, outcome])` |
| UI sin estados loading/error/empty | ✅ Agregados |
| Búsqueda sin debounce | ✅ Agregado 300ms debounce |
| Emoji sin accesibilidad | ✅ Agregado aria-label |
| Umbrales hardcodeados | ✅ Parametrizados en config |
| Filtro sin paginación | ✅ Agregado limit |

---

## MB-SENT-01: Lógica de Sentiment Derivado (V2)

**Identidad**
- ID: MB-SENT-01
- Nombre: Cálculo de sentiment sin AI
- Estado: diseño
- Tiempo estimado: 30 min

**Config de Umbrales**
```typescript
// config/sentiment.ts
export const SENTIMENT_CONFIG = {
  shortHangupSec: 10,    // Completada <10s = negativa
  fastTransferSec: 30,   // Transfer <30s = rápido (no usado en v1, prep futuro)
};
```

**Lógica Robusta (maneja nulls y 0)**
```typescript
type Sentiment = 'positive' | 'neutral' | 'negative';

interface CallData {
  outcome: string | null;
  durationSec: number | null;
  timeToTransferSec: number | null;
  endedReason: string | null;
}

function deriveSentiment(call: CallData): Sentiment {
  const { outcome, durationSec, endedReason } = call;
  
  // 1. Fallos de sistema siempre negativos (prioridad máxima)
  if (endedReason === 'system-error') {
    return 'negative';
  }
  
  // 2. Outcomes explícitamente negativos
  if (outcome === 'failed' || outcome === 'abandoned') {
    return 'negative';
  }
  
  // 3. Transfer exitoso = positivo
  if (outcome === 'transfer_success') {
    return 'positive';
  }
  
  // 4. Completada: evaluar duración
  if (outcome === 'completed') {
    // Duración muy corta = colgó rápido = negativo
    if (durationSec !== null && durationSec < SENTIMENT_CONFIG.shortHangupSec) {
      return 'negative';
    }
    // Duración normal o desconocida = neutral
    return 'neutral';
  }
  
  // 5. En progreso o desconocido = neutral
  return 'neutral';
}
```

**Criterios Autovalidables Completos**

| # | Input | Output |
|---|-------|--------|
| 1 | outcome='transfer_success', duration=20 | 'positive' |
| 2 | outcome='transfer_success', duration=null | 'positive' |
| 3 | outcome='abandoned', duration=15 | 'negative' |
| 4 | outcome='failed', duration=null | 'negative' |
| 5 | outcome='completed', duration=60 | 'neutral' |
| 6 | outcome='completed', duration=5 | 'negative' |
| 7 | outcome='completed', duration=0 | 'negative' |
| 8 | outcome='completed', duration=null | 'neutral' |
| 9 | outcome='in_progress', duration=null | 'neutral' |
| 10 | outcome='completed', endedReason='system-error' | 'negative' |
| 11 | outcome=null, duration=null | 'neutral' |

---

## MB-SENT-02: Schema, API y Backfill (V2)

**Identidad**
- ID: MB-SENT-02
- Nombre: Persistir sentiment + backfill + API filtros
- Estado: diseño
- Tiempo estimado: 45 min

**Schema Update (con índices combinados)**
```prisma
model CallMetric {
  // ... campos existentes ...
  
  sentiment     String?   // 'positive' | 'neutral' | 'negative'
  
  @@index([sentiment])
  @@index([startedAt, sentiment])
  @@index([sentiment, outcome])  // NUEVO: para filtros combinados
}
```

**Webhook Handler (guarda sentiment)**
```typescript
// En call-ended handler:
const sentiment = deriveSentiment({
  outcome,
  durationSec: call.duration ?? null,
  timeToTransferSec: metric.transferredAt && metric.startedAt
    ? (new Date(metric.transferredAt).getTime() - new Date(metric.startedAt).getTime()) / 1000
    : null,
  endedReason: call.endedReason ?? null,
});

await prisma.callMetric.update({
  where: { callId: call.id },
  data: { ...otherFields, sentiment },
});
```

**Script de Backfill**
```typescript
// scripts/backfill-sentiment.ts
async function backfillSentiment(batchSize = 500) {
  let processed = 0;
  
  while (true) {
    const calls = await prisma.callMetric.findMany({
      where: { sentiment: null, outcome: { not: null } },
      take: batchSize,
    });
    
    if (calls.length === 0) break;
    
    for (const metric of calls) {
      const ttt = metric.transferredAt && metric.startedAt
        ? (metric.transferredAt.getTime() - metric.startedAt.getTime()) / 1000
        : null;
        
      const sentiment = deriveSentiment({
        outcome: metric.outcome,
        durationSec: metric.durationSec,
        timeToTransferSec: ttt,
        endedReason: metric.endedReason,
      });
      
      await prisma.callMetric.update({
        where: { id: metric.id },
        data: { sentiment },
      });
      
      processed++;
    }
    
    console.log(`Processed ${processed} calls`);
  }
  
  console.log(`Backfill complete: ${processed} total`);
}

backfillSentiment();
```

**API con Filtros y Paginación**
```typescript
// GET /api/metrics/summary
{
  "totalCalls": 47,
  "transferRate": 0.81,
  "abandonRate": 0.12,
  "avgTimeToTransfer": 24,
  "sentimentCounts": {
    "positive": 38,
    "neutral": 5,
    "negative": 4
  }
}

// GET /api/metrics/recent?sentiment=negative&outcome=abandoned&limit=20
async function getRecent(req: Request, res: Response) {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const sentiment = req.query.sentiment as string | undefined;
  const outcome = req.query.outcome as string | undefined;
  const search = req.query.search as string | undefined;
  
  const where: Prisma.CallMetricWhereInput = {};
  
  if (sentiment) where.sentiment = sentiment;
  if (outcome) where.outcome = outcome;
  if (search) where.phoneNumber = { contains: search };
  
  const calls = await prisma.callMetric.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      phoneNumber: true,
      outcome: true,
      sentiment: true,
      durationSec: true,
      createdAt: true,
      inProgress: true,
    },
  });
  
  return res.json(calls.map(c => ({
    phone: maskPhone(c.phoneNumber),
    outcome: c.outcome,
    sentiment: c.sentiment,
    duration: c.durationSec,
    ago: formatRelative(c.createdAt),
    inProgress: c.inProgress,
  })));
}
```

**Criterios Autovalidables**

| Test | Comando | Esperado |
|------|---------|----------|
| Campo sentiment existe | `\d call_metric` | columna sentiment |
| Índice combinado | `\d call_metric` | idx_sentiment_outcome |
| Backfill funciona | `npm run backfill:sentiment` | X calls processed |
| Filtro sentiment | `curl /api/metrics/recent?sentiment=negative` | Solo negativos |
| Filtro combinado | `curl /api/metrics/recent?sentiment=positive&outcome=transfer_success` | Intersección |
| Búsqueda funciona | `curl /api/metrics/recent?search=5678` | Solo coincidencias |
| Limit respetado | `curl /api/metrics/recent?limit=5` | Max 5 resultados |

---

## MB-SENT-03: UI Components (V2)

**Identidad**
- ID: MB-SENT-03
- Nombre: Componentes UI para sentiment y filtros
- Estado: diseño
- Tiempo estimado: 1 hora

**SentimentBadge Accesible**
```tsx
const config = {
  positive: { emoji: '😊', bg: 'bg-green-100', text: 'text-green-700', label: 'Positivo' },
  neutral:  { emoji: '😐', bg: 'bg-gray-100',  text: 'text-gray-600',  label: 'Neutral' },
  negative: { emoji: '😟', bg: 'bg-red-100',   text: 'text-red-700',   label: 'Negativo' },
};

interface SentimentBadgeProps {
  sentiment: 'positive' | 'neutral' | 'negative' | null;
}

function SentimentBadge({ sentiment }: SentimentBadgeProps) {
  if (!sentiment) return <span className="text-gray-400">--</span>;
  
  const { emoji, bg, text, label } = config[sentiment];
  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded-full text-sm ${bg} ${text}`}
      aria-label={`Sentiment: ${label}`}
      title={label}
    >
      <span aria-hidden="true">{emoji}</span>
    </span>
  );
}
```

**CallFilters con Debounce**
```tsx
import { useState, useEffect, useCallback } from 'react';

interface Filters {
  search: string;
  outcome: string | null;
  sentiment: string | null;
}

interface CallFiltersProps {
  onFilterChange: (filters: Filters) => void;
  loading?: boolean;
}

function CallFilters({ onFilterChange, loading }: CallFiltersProps) {
  const [filters, setFilters] = useState<Filters>({
    search: '',
    outcome: null,
    sentiment: null,
  });
  
  // Debounce effect
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      onFilterChange(filters);
    }, 300);
    
    return () => clearTimeout(timeoutId);
  }, [filters, onFilterChange]);
  
  const updateFilter = useCallback((key: keyof Filters, value: string | null) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  return (
    <div className="flex gap-3 mb-4 flex-wrap">
      {/* Search */}
      <div className="relative">
        <input
          type="text"
          placeholder="Buscar teléfono..."
          className="px-3 py-2 pl-9 border rounded-lg bg-slate-800 border-slate-600 text-white placeholder-slate-400"
          value={filters.search}
          onChange={(e) => updateFilter('search', e.target.value)}
          aria-label="Buscar por teléfono"
        />
        <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>
      </div>
      
      {/* Outcome filter */}
      <select 
        className="px-3 py-2 border rounded-lg bg-slate-800 border-slate-600 text-white"
        value={filters.outcome || ''}
        onChange={(e) => updateFilter('outcome', e.target.value || null)}
        aria-label="Filtrar por estado"
      >
        <option value="">Todos los estados</option>
        <option value="transfer_success">✅ Transfer</option>
        <option value="abandoned">❌ Abandonó</option>
        <option value="completed">⚪ Completó</option>
        <option value="failed">⛔ Falló</option>
        <option value="in_progress">🔵 En curso</option>
      </select>
      
      {/* Sentiment filter */}
      <select
        className="px-3 py-2 border rounded-lg bg-slate-800 border-slate-600 text-white"
        value={filters.sentiment || ''}
        onChange={(e) => updateFilter('sentiment', e.target.value || null)}
        aria-label="Filtrar por sentiment"
      >
        <option value="">Todos los sentiments</option>
        <option value="positive">😊 Positivo</option>
        <option value="neutral">😐 Neutral</option>
        <option value="negative">😟 Negativo</option>
      </select>
      
      {loading && <span className="text-slate-400 self-center">⏳</span>}
    </div>
  );
}
```

**RecentCallsTable con Estados**
```tsx
interface RecentCall {
  phone: string;
  outcome: string;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  duration: number | null;
  ago: string;
  inProgress: boolean;
}

interface RecentCallsTableProps {
  calls: RecentCall[];
  loading: boolean;
  error: Error | null;
  inProgressCount: number;
}

function RecentCallsTable({ calls, loading, error, inProgressCount }: RecentCallsTableProps) {
  // Loading state
  if (loading) {
    return (
      <div className="bg-slate-800 rounded-xl p-8 text-center">
        <div className="animate-pulse text-slate-400">
          ⏳ Cargando llamadas...
        </div>
      </div>
    );
  }
  
  // Error state
  if (error) {
    return (
      <div className="bg-slate-800 rounded-xl p-8 text-center">
        <div className="text-red-400 mb-4">⚠️ Error al cargar llamadas</div>
        <button 
          className="px-4 py-2 bg-slate-700 rounded-lg hover:bg-slate-600"
          onClick={() => window.location.reload()}
        >
          Reintentar
        </button>
      </div>
    );
  }
  
  // Empty state
  if (calls.length === 0) {
    return (
      <div className="bg-slate-800 rounded-xl p-8 text-center">
        <div className="text-slate-400">
          📭 Sin llamadas que coincidan con los filtros
        </div>
      </div>
    );
  }
  
  // Data state
  return (
    <div className="bg-slate-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700 flex justify-between items-center">
        <h3 className="font-semibold">📋 Últimas llamadas</h3>
        {inProgressCount > 0 && (
          <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded-full text-sm">
            🔵 {inProgressCount} en curso
          </span>
        )}
      </div>
      
      <table className="w-full" role="table">
        <thead className="bg-slate-900/50">
          <tr>
            <th className="px-4 py-2 text-left text-sm text-slate-400">TELÉFONO</th>
            <th className="px-4 py-2 text-left text-sm text-slate-400">ESTADO</th>
            <th className="px-4 py-2 text-center text-sm text-slate-400">SENT</th>
            <th className="px-4 py-2 text-right text-sm text-slate-400">DUR</th>
            <th className="px-4 py-2 text-right text-sm text-slate-400">TIEMPO</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call, i) => (
            <tr key={i} className="border-t border-slate-700/50 hover:bg-slate-700/30">
              <td className="px-4 py-3">
                <span className="text-slate-300">{call.phone}</span>
                <span className="text-slate-500 text-xs ml-2">{call.ago}</span>
              </td>
              <td className="px-4 py-3">
                <OutcomeBadge outcome={call.outcome} inProgress={call.inProgress} />
              </td>
              <td className="px-4 py-3 text-center">
                <SentimentBadge sentiment={call.sentiment} />
              </td>
              <td className="px-4 py-3 text-right text-slate-400">
                {call.duration !== null ? `${call.duration}s` : '--'}
              </td>
              <td className="px-4 py-3 text-right text-slate-500 text-sm">
                {call.ago}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**Criterios Autovalidables**

| Test | Acción | Esperado |
|------|--------|----------|
| Badge renderiza todos | Ver tabla con pos/neu/neg | 3 tipos de emoji visibles |
| Badge null muestra -- | Call sin sentiment | "--" en columna |
| aria-label presente | Inspect badge | aria-label="Sentiment: X" |
| Loading state | Fetch en progreso | "Cargando llamadas..." |
| Error state | API falla | Mensaje error + botón retry |
| Empty state | Filtros sin resultados | "Sin llamadas que coincidan" |
| Debounce funciona | Escribir rápido en search | Solo 1 request después de 300ms |
| Filtro outcome | Seleccionar "Transfer" | API llamada con ?outcome=transfer_success |
| Filtro sentiment | Seleccionar "Negativo" | API llamada con ?sentiment=negative |
| Filtros combinan | Ambos filtros + search | Query string con todos los params |

---

## Resumen de Cambios vs V1

| Microbloque | V1 | V2 |
|-------------|-----|-----|
| MB-SENT-01 | Lógica básica | + Manejo nulls, + config umbrales, + tests completos |
| MB-SENT-02 | Schema + API | + Backfill script, + índice combinado, + paginación |
| MB-SENT-03 | UI básica | + Estados loading/error/empty, + debounce, + accesibilidad |

**Tiempo total actualizado: 2.5 horas** (+30 min por backfill y estados)

---

## Preguntas Resueltas

| Pregunta Codex | Decisión |
|----------------|----------|
| ¿Diferenciar transfer rápido/lento? | No en V1, preparado en config |
| ¿Completed largo = negativo? | No, solo <10s = negativo |
| ¿Internacionalización? | No en MVP |
