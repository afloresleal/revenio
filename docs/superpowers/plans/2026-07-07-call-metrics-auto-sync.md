# Call Metrics Auto Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatizar la reconciliacion de metricas de llamadas recientes para que dashboard/admin no dependan del boton manual de sincronizacion.

**Architecture:** Extraer la logica de sync manual de una llamada a un modulo reusable, luego agregar un worker interno del API que escanee llamadas recientes con artefactos incompletos y ejecute ese sync en background. Mantener la ruta manual existente como wrapper de la misma logica para no duplicar comportamiento.

**Tech Stack:** Node.js, Express, TypeScript, Prisma, Vapi API, Twilio API

---

### Task 1: Definir worker y criterios de elegibilidad

**Files:**
- Modify: `apps/api/test/ghl-second-attempt-worker.test.ts`
- Create: `apps/api/test/call-metrics-sync-worker.test.ts`
- Create: `apps/api/src/lib/call-metrics-sync-worker.ts`

- [ ] Agregar tests para config default, clamps y activacion del worker nuevo.
- [ ] Verificar que fallen antes de implementar.
- [ ] Implementar config/worker minimo.
- [ ] Verificar que pasen.

### Task 2: Reusar la logica de sync manual

**Files:**
- Create: `apps/api/src/lib/call-metric-sync.ts`
- Modify: `apps/api/src/routes/metrics.ts`

- [ ] Extraer helpers y la logica de `POST /api/metrics/calls/:callId/sync` a una funcion reusable.
- [ ] Mantener la ruta manual como wrapper del helper compartido.
- [ ] Agregar un helper para encontrar llamadas recientes incompletas.

### Task 3: Integrar worker en el API

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/lib/call-metrics-sync-worker.ts`

- [ ] Conectar el worker al arranque del servidor con flags/envs simples.
- [ ] Asegurar shutdown limpio igual que el worker de segundo intento.

### Task 4: Verificacion

**Files:**
- Test: `apps/api/test/call-metrics-sync-worker.test.ts`

- [ ] Ejecutar el test nuevo en rojo y luego en verde.
- [ ] Ejecutar build de `apps/api`.
- [ ] Revisar `git diff` para confirmar que no tocamos los docs sueltos del usuario.
