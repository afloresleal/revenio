# Fix: Habilitar Failover Automático en Todos los Flujos

> **Fecha:** 2026-05-14
> **Problema reportado por:** Marina (equipo)
> **Caso específico:** Llamada a Marina (+525527326714) → Gaby sin señal → buzón sin failover
> **Impacto:** TODOS los flujos de llamadas (GHL, /call/vapi, /call/test, test-campaign)

## Nota Importante: Distinción con Trabajo Anterior

**Trabajo del 2026-05-12 (CHANGELOG.md v0.3.0):**
- ✅ Detectar cuando el **CLIENTE** no contesta → outcome `voicemail`
- ✅ Se usa para mover la oportunidad de GHL al stage correcto
- ✅ Archivo: `apps/api/src/lib/sentiment.ts`
- ✅ **YA ESTÁ IMPLEMENTADO Y FUNCIONA**

**Problema actual (2026-05-14):**
- ❌ Detectar cuando el **AGENTE** (Gaby) no contesta → hacer **failover automático** al siguiente agente (Diana)
- ❌ El round robin está configurado pero **no se ejecuta** porque se usa `blind-transfer`
- ❌ Archivos: `apps/api/src/routes/webhooks.ts` y `apps/api/src/server.ts`
- ❌ **NECESITA SER IMPLEMENTADO**

Son dos problemas distintos pero relacionados con voicemail. El primero ya funciona, el segundo es lo que este documento soluciona.

## Resumen Ejecutivo

El sistema de round robin con failover automático está **completamente implementado** en el backend, pero **nunca se ejecuta** porque todas las llamadas usan `blind-transfer` via hooks, lo que bypasea completamente el flujo de detección de voicemail y failover.

**Fix requerido:** Una línea de código en `buildAssistantOverrides()` - eliminar el hook que agrega `blind-transfer`.

## Evidencia del Problema

### Log de la llamada a Marina (2026-05-14)

```json
{
  "flow": "gohighlevel",
  "assistantOverrides": {
    "hooks": [{
      "on": "call.timeElapsed",
      "options": { "seconds": 1 },
      "do": [{
        "tool": {
          "type": "transferCall",
          "destinations": [{
            "type": "number",
            "number": "+529988650335",  // Gaby
            "transferPlan": {
              "mode": "blind-transfer",  // ❌ PROBLEMA
              "sipVerb": "dial"
            }
          }]
        }
      }]
    }]
  },
  "roundRobin": {
    "strategy": "sequential_failover",
    "agents": [
      { "name": "Gaby", "priority": 1, "transferNumber": "+529988650335" },
      { "name": "Diana", "priority": 2, "transferNumber": "+525569708325" },
      { "name": "Arturo", "priority": 3, "transferNumber": "+525529009523" }
    ]
  }
}
```

**Qué pasó:**
1. ✅ Vapi contestó llamada a Marina (+525527326714)
2. ✅ Después de 1 segundo ejecutó el hook con `blind-transfer`
3. ❌ Transfirió directamente a Gaby (+529988650335) SIN AMD
4. ❌ Gaby no tenía señal → llamada cayó en su buzón
5. ❌ **NO hubo failover** a Diana ni Arturo
6. ❌ Round robin configurado pero **nunca se ejecutó**

**Razón:** `blind-transfer` NO permite detección de voicemail ni failover. La llamada se transfiere y se queda ahí, sin importar si el agente contesta o no.

## Análisis Técnico

### Código Problemático

**Ubicación:**
- `apps/api/src/routes/webhooks.ts:131-172`
- `apps/api/src/server.ts:1926-1967` (duplicado)

**Función problemática:**
```typescript
function buildAssistantOverrides(
  safeName: string | null,
  leadId: string,
  attemptId: string,
  transferNumber?: string | null,
  agentName?: string | null,
): Record<string, unknown> {
  const metadata = { lead_id: leadId, attempt_id: attemptId };
  const variableValues: Record<string, string> = {};
  if (safeName) variableValues.name = safeName;
  if (transferNumber) variableValues.transfer_number = transferNumber;
  if (agentName) variableValues.agent_name = agentName;
  const overrides: Record<string, unknown> = { metadata };
  if (Object.keys(variableValues).length) overrides.variableValues = variableValues;

  if (transferNumber) {
    overrides.hooks = [buildImmediateTransferHook(transferNumber)]; // ❌ ESTA LÍNEA
  }

  return overrides;
}
```

### Endpoints Afectados (100% de llamadas)

| Endpoint | Archivo | Línea | Flujo |
|----------|---------|-------|-------|
| `POST /webhooks/gohighlevel` | webhooks.ts | 1441 | Webhook GHL → Vapi |
| `POST /call/vapi` | server.ts | 2153 | Legacy API directa |
| `POST /call/test` | server.ts | 2415 | Pruebas manuales |
| `POST /test-campaign/:campaignId/call` | server.ts | 3038 | Test de campañas |

**Impacto:** TODAS las llamadas creadas por cualquier endpoint usan `blind-transfer` sin failover.

## Flujo Actual vs Flujo Correcto

### Flujo Actual (INCORRECTO - con blind-transfer)

```
1. Backend crea llamada con assistantOverrides.hooks[blind-transfer]
2. Vapi ejecuta el hook después de 1 segundo
3. Transfiere directamente al agente SIN AMD
4. Si agente no contesta → va a voicemail del agente
5. ❌ NO hay detección de voicemail
6. ❌ NO hay failover automático
7. ❌ Round robin nunca se ejecuta
8. Dashboard no muestra quién no respondió
```

### Flujo Correcto (CON failover - transfer-destination-request)

```
1. Backend crea llamada SIN hooks (solo metadata + variableValues)
2. Vapi solicita transfer via webhook transfer-destination-request
3. Backend responde con número del agente actual (código YA EXISTE)
4. Vapi/Twilio hacen transfer CON AMD (Answering Machine Detection)
5. ✅ Twilio detecta voicemail/no-answer/busy
6. ✅ Backend recibe callback de Twilio con razón real
7. ✅ Backend ejecuta failover al siguiente agente
8. ✅ Si segundo no contesta → intenta con tercero
9. ✅ Dashboard muestra quién no respondió y por qué
```

## Solución

### Cambio Requerido

**Archivo:** `apps/api/src/routes/webhooks.ts` (líneas 154-172)
**Archivo:** `apps/api/src/server.ts` (líneas 1949-1967)

**Antes:**
```typescript
function buildAssistantOverrides(
  safeName: string | null,
  leadId: string,
  attemptId: string,
  transferNumber?: string | null,
  agentName?: string | null,
): Record<string, unknown> {
  const metadata = { lead_id: leadId, attempt_id: attemptId };
  const variableValues: Record<string, string> = {};
  if (safeName) variableValues.name = safeName;
  if (transferNumber) variableValues.transfer_number = transferNumber;
  if (agentName) variableValues.agent_name = agentName;
  const overrides: Record<string, unknown> = { metadata };
  if (Object.keys(variableValues).length) overrides.variableValues = variableValues;
  if (transferNumber) {
    overrides.hooks = [buildImmediateTransferHook(transferNumber)]; // ❌ QUITAR
  }
  return overrides;
}
```

**Después:**
```typescript
function buildAssistantOverrides(
  safeName: string | null,
  leadId: string,
  attemptId: string,
  transferNumber?: string | null,
  agentName?: string | null,
): Record<string, unknown> {
  const metadata = { lead_id: leadId, attempt_id: attemptId };
  const variableValues: Record<string, string> = {};
  if (safeName) variableValues.name = safeName;
  if (transferNumber) variableValues.transfer_number = transferNumber;
  if (agentName) variableValues.agent_name = agentName;
  const overrides: Record<string, unknown> = { metadata };
  if (Object.keys(variableValues).length) overrides.variableValues = variableValues;

  // ✅ NO agregar hooks - dejar que Vapi solicite transfer via transfer-destination-request
  // El backend YA responde correctamente en processTransferUpdate() (línea 2295-2374)

  return overrides;
}
```

**Opcional:** También eliminar `buildImmediateTransferHook()` ya que no se usará más.

## Evidencia de que el Código de Failover YA EXISTE

El backend **ya tiene todo implementado** para que funcione el failover:

### 1. Handler de transfer-destination-request

**Archivo:** `apps/api/src/routes/webhooks.ts:2295-2374`

```typescript
async function processTransferUpdate(body: unknown): Promise<HandlerResult | null> {
  const eventType = asString(message?.type);
  if (eventType !== 'transfer-update' && eventType !== 'transfer-destination-request') {
    return null;
  }

  // ... código para resolver transferNumber desde round robin ...

  if (eventType === 'transfer-destination-request') {
    // ✅ Responde con el número del agente actual
    return {
      destination: {
        type: 'number',
        number: resolvedTransferNumber,
      },
    };
  }
}
```

### 2. Callbacks de Twilio con AMD

**Archivo:** `apps/api/src/routes/webhooks.ts` (múltiples handlers)

- ✅ `/webhooks/twilio/transfer-status` - Recibe DialCallStatus
- ✅ AMD configurado en `<Dial>` con `machineDetection="DetectMessageEnd"`
- ✅ Detecta: `no-answer`, `busy`, `failed`, `voicemail` (via AnsweredBy)

### 3. Lógica de Round Robin Secuencial

**Archivo:** `apps/api/src/lib/ghl-campaigns.ts:229-258`

```typescript
export function selectCampaignTestTransfer(params: {
  agents: CampaignTestAgent[];
  fallback?: CampaignTestFallback | null;
}): CampaignTestTransfer | null {
  const activeAgents = params.agents
    .filter((agent) => agent.active !== false)
    .filter((agent) => asString(agent.transferNumber))
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)); // ✅ Por prioridad

  const selectedAgent = activeAgents[0]; // ✅ Primer agente activo
  // ... fallback logic ...
}
```

### 4. Métricas y Dashboard

**Archivos:**
- `apps/api/src/routes/webhooks.ts` - Registra razones de fallo por agente
- `apps/api/src/routes/metrics.ts` - Expone métricas de transferencia
- `dashboard-v2/` - Muestra quién no respondió y por qué

**Todo este código ya está implementado.** Solo necesita ser **activado** quitando el hook con blind-transfer.

## Configuración de Vapi Requerida

**IMPORTANTE:** Para que funcione el flujo correcto, los Vapi Assistants deben tener:

### 1. Crear Transfer Tool

**En Vapi Dashboard → Tools:**
1. Click "Create Tool"
2. Tool Name: `transfer_call_tool`
3. Tool Type: `transferCall`
4. Description: "Transfers call to human agent"
5. **NO agregar destinations** (el backend responde dinámicamente via webhook)
6. Save tool

### 2. Asignar Tool al Assistant

**En Vapi Dashboard → Assistants → [tu assistant]:**
1. Ve a la pestaña "Tools"
2. Click "+ Add Tool"
3. Selecciona `transfer_call_tool`
4. Save assistant

### 3. Configurar Webhook Server

**En Vapi Dashboard → Assistants → [tu assistant] → Webhook Server:**
- **Server URL:**
  - Staging: `https://revenioapi-staging.up.railway.app/webhooks/vapi/events`
  - Production: `https://revenioapi-production.up.railway.app/webhooks/vapi/events`

### 4. Server Messages (en Vapi dashboard)

✅ **Activar:**
- `transfer-destination-request` (CRÍTICO)
- `transfer-update`
- `speech-update`
- `tool-calls`
- `end-of-call-report`

❌ **Desactivar:**
- `phone-call-control` (causa problemas de transfer)

### ⚠️ Errores Comunes

❌ NO agregar destinations al tool (debe quedar vacío)
❌ NO agregar `Forwarding Phone Number` / fallback fijo en el assistant
❌ NO agregar hooks con `blind-transfer` en el assistant (Revenio los elimina con este fix)
❌ NO olvidar asignar el tool al assistant (crearlo no es suficiente)

## Plan de Implementación

### Paso 1: Modificar Código

```bash
cd revenio/apps/api/src
# Editar routes/webhooks.ts líneas 154-172
# Editar server.ts líneas 1949-1967
```

### Paso 2: Build y Pruebas Locales

```bash
npm -w apps/api run build  # Verificar que compila
npm run dev                # Levantar API local
npm run lab                # Levantar Lab para pruebas
```

### Paso 3: Pruebas en Staging

1. Deploy a Railway staging
2. Verificar que el Assistant de Vapi apunte al webhook staging
3. Crear llamada de prueba con round robin de 3 agentes
4. NO contestar el primer agente → verificar failover al segundo
5. NO contestar el segundo → verificar failover al tercero
6. Verificar que dashboard muestre correctamente quién no respondió

### Paso 4: Deploy a Production

1. Merge a `main`
2. Deploy a Railway production
3. Monitorear primeras llamadas reales

## Casos de Prueba

### Test 1: Primer agente no contesta (voicemail)

**Setup:**
- Agentes: Gaby (1), Diana (2), Arturo (3)
- Gaby sin señal / no contesta

**Resultado esperado:**
1. ✅ Transfiere a Gaby
2. ✅ Detecta voicemail/no-answer
3. ✅ Failover automático a Diana
4. ✅ Si Diana contesta → llamada exitosa
5. ✅ Dashboard muestra: Gaby (no-answer/voicemail), Diana (answered)

### Test 2: Todos los agentes no contestan

**Setup:**
- Agentes: Gaby (1), Diana (2), Arturo (3)
- NINGUNO contesta

**Resultado esperado:**
1. ✅ Intenta Gaby → no contesta
2. ✅ Intenta Diana → no contesta
3. ✅ Intenta Arturo → no contesta
4. ✅ Llamada termina (sin agentes disponibles)
5. ✅ Dashboard muestra: todos con razón (voicemail/no-answer)

### Test 3: Segundo agente contesta

**Setup:**
- Agentes: Gaby (1), Diana (2), Arturo (3)
- Gaby ocupado, Diana contesta

**Resultado esperado:**
1. ✅ Transfiere a Gaby → detecta busy
2. ✅ Failover a Diana → contesta
3. ✅ Llamada continúa con Diana
4. ✅ Dashboard muestra: Gaby (busy), Diana (answered)

## Validación Post-Deploy

### Logs esperados en Vapi webhook

**Antes del fix (incorrecto):**
```json
{
  "message": {
    "type": "status-update",
    "status": "forwarding-phone-call"
  }
  // ❌ NO hay transfer-destination-request
}
```

**Después del fix (correcto):**
```json
{
  "message": {
    "type": "transfer-destination-request",
    "call": { "id": "..." }
  }
  // ✅ Backend responde con destination
}
```

### Logs esperados en Twilio callbacks

**Con failover funcionando:**
```
1. DialCallStatus=no-answer, To=+529988650335 (Gaby)
   → Backend inicia failover a Diana
2. DialCallStatus=completed, To=+525569708325 (Diana)
   → Transfer exitoso
```

### Métricas en Dashboard

**Campos poblados correctamente:**
- `firstAgentName`: "Gaby"
- `answeredAgentName`: "Diana"
- `failoverSteps`: ["Gaby: no-answer", "Diana: answered"]
- `transferStatus`: "connected"
- `sellerTalkSec`: > 0

## Referencias

- `docs/CALL-TRANSFER-HANDOFF-2026-04-08.md` - Fuente de verdad del flujo de transfer
- `docs/VAPI-CONFIG.md` - Configuración de Vapi assistants
- `docs/GHL-DEMO-HANDOFF-2026-05-03.md` - Contexto histórico GHL

## Checklist Pre-Deploy

- [ ] Código modificado en `webhooks.ts`
- [ ] Código modificado en `server.ts`
- [ ] Build exitoso (`npm -w apps/api run build`)
- [ ] Vapi assistants configurados con `transfer-destination-request` activo
- [ ] `phone-call-control` desactivado en Vapi
- [ ] NO hay tools nativos de transfer en Vapi
- [ ] Prueba local con Lab exitosa
- [ ] Prueba en staging con round robin de 3 agentes
- [ ] Verificado failover cuando primer agente no contesta
- [ ] Dashboard muestra correctamente los resultados

## Impacto Esperado

**Antes del fix:**
- ❌ 0% de llamadas con failover automático
- ❌ Si agente no contesta → va a voicemail, termina la interacción
- ❌ Round robin configurado pero nunca se ejecuta

**Después del fix:**
- ✅ 100% de llamadas con failover automático
- ✅ Si agente no contesta → intenta siguiente agente
- ✅ Round robin secuencial funcionando
- ✅ Dashboard muestra quién no respondió y por qué
- ✅ Mejor tasa de conexión con agentes humanos
