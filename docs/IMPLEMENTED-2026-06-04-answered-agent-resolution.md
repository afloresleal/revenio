# Fix: Resolver correctamente qué vendedor contestó en llamadas transferidas

> **Fecha:** 2026-06-04
> **Problema reportado por:** equipo interno durante prueba real con cliente
> **Caso de referencia:** llamada `019e94de-58e0-7000-a20b-ea4aa4c2ad30`
> **Impacto:** Dashboard, Admin > Llamadas, CSV de campañas y `assignedTo` enviado a GHL

## Resumen ejecutivo

El sistema mostraba y enviaba como vendedor que contestó al primer agente del pool, aunque la llamada realmente hubiera sido contestada por otro vendedor.

El caso real que detonó el fix quedó así:

- `transferNumber = +529841679017`
- el transcript humano empieza con `Hola, ¿Matías?`
- pero el dashboard mostraba `Conectó con: Ileana M Cazares`

La causa no era una sola. Había una combinación de:

1. metadata histórica inconsistente guardada en `roundRobin`;
2. rutas viejas que seguían leyendo `answeredAgentName` en crudo;
3. snapshots de llamada que podían quedar corruptos aunque el número final de transferencia fuera correcto.

La solución final fue tratar el **número final conectado** como fuente principal de verdad cuando existe evidencia humana real, y usar además la **configuración actual de agentes de la campaña** como respaldo canónico.

---

## Síntoma real observado

El endpoint productivo de detalle de llamada devolvía una combinación internamente imposible:

```json
{
  "transferNumber": "+529841679017",
  "roundRobinAnsweredAgentName": "Ileana M Cazares",
  "roundRobinAnsweredAgentNumber": "+529841679017",
  "roundRobinAnsweredAgentIndex": 0
}
```

Ese payload mezcla:

- **nombre e índice** del primer agente;
- **número** del segundo agente.

Operativamente, eso significa que la llamada sí terminó conectando al número correcto, pero el snapshot histórico de `roundRobin` quedó parcialmente corrupto.

---

## Causa raíz

### 1. Metadata `answeredAgent*` tratada como verdad absoluta

La primera implementación confiaba demasiado en:

- `roundRobin.answeredAgentName`
- `roundRobin.answeredAgentNumber`
- `roundRobin.answeredAgentIndex`

Si esos campos existían, se usaban aunque contradijeran el `transferNumber` final de la llamada.

### 2. Snapshot histórico de agentes no siempre confiable

En algunas llamadas, el `resultJson.roundRobin.agents` guardado en el intento no representaba de forma consistente al agente realmente conectado.

Eso significa que incluso corrigiendo la prioridad entre nombre/número, todavía podíamos seguir resolviendo mal si el snapshot almacenado ya venía defectuoso.

### 3. Dos caminos distintos de lectura

El dato no se renderizaba desde un solo lugar:

- `apps/api/src/routes/metrics.ts`
- `apps/api/src/server.ts` (Admin / llamadas y export CSV)

Los fixes iniciales corrigieron una ruta, pero la otra todavía seguía leyendo valores viejos del `resultJson`.

---

## Solución final implementada

### Regla canónica

Cuando existe evidencia humana real:

- `postTransferDurationSec > 0`, o
- transcript humano, o
- recording de transfer, o
- status operativo equivalente,

entonces el sistema resuelve al vendedor contestado usando este orden:

1. **Agentes actuales configurados en la campaña** (`ghlHumanAgent`) por coincidencia de `transferNumber`
2. **Snapshot histórico del intento** (`resultJson.roundRobin.agents`) por coincidencia de `transferNumber`
3. solo si no existe evidencia suficiente, se permite caer a metadata explícita vieja

En otras palabras:

```text
número final conectado + evidencia humana real
  -> identidad canónica del vendedor que contestó
```

### Efecto práctico

Si el número final es el de Matias, pero el nombre histórico dice Ileana:

- se resuelve como **Matias**
- se corrige el dato mostrado en dashboard y admin
- se corrige el dato exportado en CSV
- se corrige el `assignedTo` enviado a GHL

---

## Componentes corregidos

### 1. Resolución compartida de answered agent

**Archivo:** `apps/api/src/lib/round-robin-resolution.ts`

Se consolidó la lógica para:

- detectar evidencia humana real;
- buscar vendedor por número final;
- usar agentes actuales de campaña como fuente canónica;
- caer al snapshot histórico solo cuando sea necesario.

### 2. Dashboard Metrics API

**Archivo:** `apps/api/src/routes/metrics.ts`

Ahora:

- la respuesta de detalle de llamada usa resolución canónica;
- la lista reciente usa la misma regla;
- la línea de “primer intento” deja de afirmar falsamente que el primer agente conectó si el vendedor real fue otro.

### 3. Legacy Admin / llamadas / CSV

**Archivo:** `apps/api/src/server.ts`

Ahora:

- Admin > Llamadas usa la misma resolución canónica;
- el CSV exporta `answered_agent` desde esa misma fuente;
- la vista vieja deja de mostrar nombres viejos si contradicen el número final.

### 4. Push a GHL

**Archivo:** `apps/api/src/routes/webhooks.ts`

`pushSuccessfulTransferToGhl()` ya no depende solo de metadata vieja del intento y usa la resolución corregida para `assignedTo`.

---

## Estrategia de mitigación

Este fix fue incremental porque el problema real apareció en capas:

### Fase 1

Resolver answered agent desde `transferNumber` en dashboard y GHL.

### Fase 2

Ignorar metadata vieja cuando contradice el número final conectado.

### Fase 3

Aplicar la misma regla a la ruta legacy del admin y CSV.

### Fase 4

Agregar fallback contra la configuración actual de agentes de la campaña cuando el snapshot histórico ya estaba corrupto.

La fase 4 fue la que resolvió el caso real en producción.

---

## Validación

Se validó con:

- `npx tsx apps/api/test/metrics-round-robin-resolution.test.ts`
- `npx tsx apps/api/test/transfer-failover.test.ts`
- `npm --prefix apps/api run build`
- `npm --prefix dashboard-v2 run build`

Se agregaron pruebas específicas para estos casos:

1. metadata explícita consistente;
2. metadata vieja que contradice el número final;
3. metadata vieja donde el nombre/index están mal pero el número final coincide con otro vendedor;
4. fallback exitoso contra agentes actuales de campaña.

---

## Archivos principales

- `apps/api/src/lib/round-robin-resolution.ts`
- `apps/api/src/routes/metrics.ts`
- `apps/api/src/routes/webhooks.ts`
- `apps/api/src/server.ts`
- `apps/api/test/metrics-round-robin-resolution.test.ts`

---

## Commits relacionados

### Main

- `27acf86` - `fix answered agent resolution for dashboard and GHL`
- `9ca4731` - `fix stale answered agent metadata precedence`
- `6a5e807` - `fix answered agent resolution in legacy admin views`
- `0631818` - `fix answered agent fallback from campaign config`

### Develop

- `5f61d22` - `fix answered agent resolution for dashboard and GHL`
- `715311b` - `fix stale answered agent metadata precedence`
- `2f09acd` - `fix answered agent resolution in legacy admin views`
- `83f1c59` - `fix answered agent fallback from campaign config`

---

## Lección operativa

En transferencias con failover, `answeredAgentName` histórico no debe tratarse como verdad absoluta.

La fuente más confiable para reconstruir quién contestó realmente es:

```text
evidencia humana real
  + número final conectado
  + configuración actual del pool de agentes
```

Esto es especialmente importante cuando se reutiliza el mismo dato para:

- métricas;
- UI operativa;
- export CSV;
- asignación de oportunidad en GHL.
