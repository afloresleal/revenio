# Prompt Actualizado para UI Generator

Este prompt extiende el dashboard generado con sentiment badge y filtros.

---

## PROMPT

```
Actualiza el dashboard de Revenio Voice Metrics para agregar sentiment badges y filtros.

CAMBIOS REQUERIDOS:

1. **Nueva columna "SENT" en tabla de llamadas**
   - Posición: después de "ESTADO", antes de "DUR"
   - Contenido: emoji de sentiment con tooltip
   - Valores:
     - 😊 (verde) = Positivo (transfer exitoso)
     - 😐 (gris) = Neutral (completada sin issues)
     - 😟 (rojo) = Negativo (abandono, fallo, colgar rápido)
   - Si sentiment es null, mostrar "--"
   - Accesibilidad: aria-label="Sentiment: [Positivo|Neutral|Negativo]"

2. **Barra de filtros encima de la tabla**
   Layout horizontal con gap-3:
   
   [🔍 Buscar teléfono...] [Todos los estados ▾] [Todos los sentiments ▾]
   
   - Input de búsqueda:
     - Placeholder: "Buscar teléfono..."
     - Ícono 🔍 a la izquierda
     - Debounce de 300ms antes de filtrar
   
   - Dropdown "Todos los estados":
     - Opciones: Todos, ✅ Transfer, ❌ Abandonó, ⚪ Completó, ⛔ Falló, 🔵 En curso
     - Valores API: transfer_success, abandoned, completed, failed, in_progress
   
   - Dropdown "Todos los sentiments":
     - Opciones: Todos, 😊 Positivo, 😐 Neutral, 😟 Negativo
     - Valores API: positive, neutral, negative

3. **Indicador de loading en filtros**
   - Cuando se está filtrando, mostrar spinner ⏳ al lado de los filtros
   - Debounce evita múltiples requests

4. **Estados de la tabla actualizados**
   
   LOADING:
   ```
   ┌─────────────────────────────────────┐
   │  ⏳ Cargando llamadas...            │
   │  [skeleton animation]               │
   └─────────────────────────────────────┘
   ```
   
   ERROR:
   ```
   ┌─────────────────────────────────────┐
   │  ⚠️ Error al cargar llamadas        │
   │  [Reintentar]                       │
   └─────────────────────────────────────┘
   ```
   
   SIN RESULTADOS:
   ```
   ┌─────────────────────────────────────┐
   │  📭 Sin llamadas que coincidan      │
   │  con los filtros                    │
   └─────────────────────────────────────┘
   ```

5. **Actualizar summary con sentiment counts**
   
   Agregar mini-badges debajo de las 4 cards principales:
   ```
   Sentiment: 😊 38  😐 5  😟 4
   ```
   
   O como tooltip en alguna card existente.

6. **Nuevo layout de tabla con columna SENT**
   ```
   ┌──────────────────────────────────────────────────────────────────────┐
   │  📋 Últimas llamadas                              [En curso: 2]      │
   ├──────────────────────────────────────────────────────────────────────┤
   │  [🔍 Buscar...]  [Todos estados ▾]  [Todos sentiments ▾]             │
   ├──────────────────────────────────────────────────────────────────────┤
   │  TELÉFONO          │ ESTADO       │ SENT │ DUR   │ TIEMPO           │
   │  +52 55 **** 5678  │ ✅ Transfer  │  😊  │  32s  │ hace 5 min       │
   │  +52 33 **** 4321  │ ❌ Abandonó  │  😟  │  18s  │ hace 12 min      │
   │  +52 81 **** 3333  │ 🔵 En curso  │  😐  │  --   │ hace 1 min       │
   │  +52 55 **** 0000  │ ✅ Transfer  │  😊  │  41s  │ hace 23 min      │
   │  +52 33 **** 2222  │ ⚪ Completó  │  😐  │  95s  │ hace 31 min      │
   │  +52 44 **** 1111  │ ⛔ Falló     │  😟  │   5s  │ hace 45 min      │
   └──────────────────────────────────────────────────────────────────────┘
   ```

ESTILOS ADICIONALES:

- Filtros: mismo estilo dark que el resto (bg-slate-800, border-slate-600)
- Inputs: placeholder-slate-400, text-white
- Selects: appearance con chevron
- Focus: ring-2 ring-blue-500

DATOS DE EJEMPLO ACTUALIZADOS:

```json
{
  "summary": {
    "totalCalls": 47,
    "transferRate": 0.81,
    "abandonRate": 0.12,
    "avgTimeToTransfer": 24,
    "inProgressCount": 2,
    "sentimentCounts": {
      "positive": 38,
      "neutral": 5,
      "negative": 4
    }
  },
  "recent": [
    { "phone": "+52 55 **** 5678", "outcome": "transfer_success", "sentiment": "positive", "duration": 32, "ago": "5 min" },
    { "phone": "+52 33 **** 4321", "outcome": "abandoned", "sentiment": "negative", "duration": 18, "ago": "12 min" },
    { "phone": "+52 81 **** 3333", "outcome": "in_progress", "sentiment": "neutral", "duration": null, "ago": "1 min" },
    { "phone": "+52 55 **** 0000", "outcome": "transfer_success", "sentiment": "positive", "duration": 41, "ago": "23 min" },
    { "phone": "+52 33 **** 2222", "outcome": "completed", "sentiment": "neutral", "duration": 95, "ago": "31 min" },
    { "phone": "+52 44 **** 1111", "outcome": "failed", "sentiment": "negative", "duration": 5, "ago": "45 min" }
  ]
}
```

COMPONENTES A CREAR/MODIFICAR:

1. SentimentBadge - nuevo componente
2. CallFilters - nuevo componente
3. RecentCallsTable - modificar para incluir SENT y estados
4. useCallFilters - hook para manejar estado de filtros con debounce

COMPORTAMIENTO:

1. Al cargar la página: mostrar loading, luego datos
2. Al cambiar filtro de dropdown: aplicar inmediatamente + loading
3. Al escribir en búsqueda: debounce 300ms, luego filtrar + loading
4. Si hay error de API: mostrar error con botón retry
5. Si filtros no retornan datos: mostrar mensaje vacío
6. Los filtros se combinan (AND): outcome=X AND sentiment=Y AND phone CONTAINS search

ACCESIBILIDAD:

- Todos los inputs con aria-label
- Badge de sentiment con title y aria-label
- role="table" en la tabla
- Colores + iconos (no solo color como indicador)
```

---

## Para Validación Codex

¿Este prompt es completo y específico para que un AI UI generator produzca el resultado correcto?

Verificar:
1. ¿Especifica todos los estados UI?
2. ¿Los datos de ejemplo cubren todos los casos?
3. ¿El comportamiento de filtros está claro?
4. ¿Falta algún detalle de estilos?
