# Changelog

Todos los cambios notables en este proyecto serán documentados aquí.

## [0.3.3] - 2026-05-16

### Fix: Auto-Transfer Inmediato con Warm-Transfer Mode

**Problema:** Después de remover blind-transfer (v0.3.1), el assistant esperaba respuesta del usuario antes de ejecutar el transfer, causando delays de 9-12 segundos y permitiendo interrupciones.

**Solución:** Implementar hook auto-trigger con warm-transfer mode que ejecuta el transfer automáticamente después del firstMessage, manteniendo AMD y failover activos.

**Approach técnico:**
- **Hook Vapi:** `call.timeElapsed` con 12 segundos (duración del firstMessage)
- **Transfer mode:** `warm-transfer-experimental` (NO blind-transfer)
- **Destino dinámico:** Sin destinations hardcoded, usa `transfer-destination-request` webhook
- **AMD habilitado:** Twilio detecta answering machines y activa failover
- **Round robin:** Failover automático funciona correctamente

**Comportamiento esperado:**
1. Assistant dice firstMessage completo (~12 seg)
2. Hook dispara `transferCall` automáticamente
3. Vapi solicita destino vía webhook `transfer-destination-request`
4. Backend responde con número dinámico (round robin o del request)
5. Transfer se ejecuta con AMD y failover habilitados

**Diferencia vs blind-transfer:**
| Feature | Blind-transfer (v0.2) | Warm-transfer hook (v0.3.3) |
|---------|----------------------|----------------------------|
| Transfer inmediato | ✅ Sí | ✅ Sí |
| AMD habilitado | ❌ No | ✅ Sí |
| Failover funciona | ❌ No | ✅ Sí |
| Destino dinámico | ❌ Hardcoded | ✅ Webhook |

**Archivos modificados:**
- `apps/api/src/routes/webhooks.ts` - Agregado `buildImmediateWarmTransferHook()`
- `apps/api/src/routes/webhooks.ts` - Modificado `buildAssistantOverrides()` para incluir hook

**Testing:**
- ✅ Transfer se dispara inmediatamente después del firstMessage
- ✅ No espera respuesta del usuario
- ✅ AMD detecta voicemail y activa failover
- ✅ Round robin funciona con múltiples agentes

**Reported by:** Marina + testing con assistant `Isla-Blanca_v.corta`

---

## [0.3.2] - 2026-05-14

### Feature: Horario de Llamadas por Campaña

**Nueva funcionalidad:** Configuración de horarios de llamada específicos por campaña desde Admin UI.

**Capacidades:**
- **Modo Global** (default): Usa el horario configurado en Lab para toda la plataforma
- **Modo Custom**: Horario personalizado por campaña con:
  - Timezone específico (13 zonas horarias disponibles)
  - Horas de inicio/fin (0-23)
  - Días de la semana activos (Dom-Sáb)
  - Aplicación automática al failover de round robin
- **Modo 24/7**: Sin restricciones de horario para campañas específicas

**Backend (Fase 1):**
- 6 nuevas columnas en `ghl_campaign` (nullable para backward compatibility)
- Lógica `evaluateCampaignCallWindow()` con 3 modos:
  - `null` → Usa horario global (backward compatible)
  - `false` → 24/7 sin restricciones
  - `true` → Usa configuración específica de campaña
- Integración en webhook GHL: valida horario antes de iniciar llamada

**Frontend (Fase 2):**
- Nueva sección "Horario de llamadas" en Admin panel
- Radio buttons para selección de modo
- Campos condicionales para modo custom (timezone, horas, días)
- Persistencia en localStorage para draft state
- Validación Zod en backend

**Archivos principales:**
- `apps/api/prisma/migrations/20260514210000_add_call_window_to_campaign/` - Migración DB
- `apps/api/src/lib/call-window.ts` - Lógica de evaluación (~120 líneas)
- `apps/api/src/routes/webhooks.ts:1309` - Integración en GHL webhook
- `apps/api/src/server.ts` - Schema Zod + normalización
- `apps/admin/public/index.html` - UI de configuración
- `apps/admin/public/app.js` - Lógica frontend

**Backward compatibility:**
- ✅ Campañas existentes mantienen comportamiento actual (null = horario global)
- ✅ Sin necesidad de reconfiguración
- ✅ Opt-in: solo campañas configuradas usan horarios custom

**Documentación completa:** `docs/CALL-WINDOW-PER-CAMPAIGN-ANALYSIS.md`

**Commits principales:**
- `ffa5e6a` - Fase 1: Backend y lógica de evaluación
- `3d1ce34` - Fase 2: Admin UI completo
- `3aae153` - Fix: Layout de radio buttons y checkboxes
- `912a32a` - Simplificación: Failover siempre aplicado por default

---

## [0.3.1] - 2026-05-14

### Fix: Habilitado Failover Automático para Todos los Flujos

**Problema reportado por:** Marina (equipo)

**Caso específico:**
- Llamada a Marina (+525527326714) transferida a Gaby (+529988650335)
- Gaby sin señal → llamada cayó en buzón de voz de Gaby
- Round robin configurado con 3 agentes (Gaby, Diana, Arturo) pero **NO se ejecutó failover**
- Marina terminó en el buzón sin que se intentara con Diana o Arturo

**Causa raíz:**
Todas las llamadas usaban `blind-transfer` (transferencia ciega) via hooks de Vapi, lo que bypaseaba completamente el sistema de failover automático ya implementado en el backend.

**Solución implementada:**
- Eliminado hook de `blind-transfer` en `buildAssistantOverrides()`
- Ahora Vapi solicita transfer via webhook `transfer-destination-request`
- Habilitado AMD (Answering Machine Detection) de Twilio automáticamente
- Failover secuencial funciona cuando un agente no contesta, está ocupado, o cae en voicemail

**Archivos modificados:**
- `apps/api/src/routes/webhooks.ts` - Eliminado hook de blind-transfer en buildAssistantOverrides()
- `apps/api/src/server.ts` - Mismo cambio en función duplicada
- Eliminada función `buildImmediateTransferHook()` (ya no se usa)

**Configuración requerida en Vapi Dashboard:**
- ⚠️ **CRÍTICO**: Cada assistant debe tener el tool `transferCall` configurado:
  1. Crear tool `transfer_call_tool` en Tools section
  2. Agregar el tool al assistant en la sección "Tools"
  3. Configurar Webhook Server URL: `https://revenioapi-[env].up.railway.app/webhooks/vapi/events`
  4. El tool NO necesita destinations configuradas (backend responde dinámicamente)
- Sin esta configuración, las transferencias fallarán silenciosamente

**Impacto:**
- ✅ Todos los endpoints de llamadas ahora usan AMD + failover automático:
  - `POST /webhooks/gohighlevel` (Webhook GHL)
  - `POST /call/vapi` (API legacy)
  - `POST /call/test` (Pruebas manuales)
  - `POST /test-campaign/:campaignId/call` (Test de campañas)
- ✅ Round robin secuencial funcionando: Agente 1 → Agente 2 → Agente 3
- ✅ Dashboard muestra quién no respondió y por qué
- ✅ Mejor tasa de conexión con agentes humanos

**Referencia técnica completa:** `docs/IMPLEMENTED-2026-05-14-blind-transfer-fix.md`

**Nota:** Este fix es **distinto** del trabajo sobre detección de voicemail del cliente implementado en v0.3.0. Ese detecta cuando el **cliente** no contesta. Este fix habilita failover cuando el **agente** no contesta.

---

## [0.3.0] - 2026-05-12

### Admin UI - GHL Stage Mapping Simplificado

**Problema resuelto:**
El admin tenía 7 campos confusos para stage mapping que no tenía sentido para usuarios de marketing. Los outcomes del sistema (transfer_success, abandoned, completed) no coincidían con los campos del admin (transferred, voicemail, abandoned, transfer_failed, no_answer).

**Solución implementada:**
- Simplificado de 7 campos a solo 2 campos claros en el admin
- Implementada detección automática de voicemail del cliente
- Mejorada terminología para usar lenguaje de GHL en vez de términos técnicos

**Cambios técnicos:**

1. **Backend - Detección de Voicemail** (`apps/api/src/lib/sentiment.ts`)
   - Nuevo outcome `voicemail` agregado al sistema
   - Se detecta automáticamente cuando Vapi reporta: `no-answer`, `voicemail-beep`, `voicemail`
   - Función `determineOutcome()` ahora retorna: `transfer_success | voicemail | abandoned | completed`

2. **Backend - Stage Mapping** (`apps/api/src/lib/ghl-campaigns.ts`, `apps/api/src/server.ts`)
   - Tipo `GhlStageMapping` simplificado a solo: `transfer_success` y `voicemail`
   - Eliminados campos innecesarios: `abandoned`, `transfer_failed`, `no_answer`
   - Validación Zod actualizada para reflejar solo 2 campos

3. **Admin UI** (`apps/admin/public/index.html`, `apps/admin/public/app.js`)
   - **Antes:** 5 campos separados (transferred, voicemail, abandoned, transfer_failed, no_answer)
   - **Ahora:** 1 solo campo "GHL Connected Stage ID" que aplica para ambos casos
   - Secciones reorganizadas con headers claros:
     - **Configuración de Pipeline**: API key, Pipeline ID, New Lead Stage ID, Connected Stage ID
     - **Custom Fields**: Outcome, Seller Talk, Recording URL
   - Placeholders mejorados: en vez de IDs largos, ahora dice "Copia el ID del stage 'Contacted'"
   - Labels con terminología GHL: "GHL New Lead Stage ID" en vez de "GHL Trigger Stage ID"

4. **Fix Bug "Failed to fetch"** (`apps/api/src/server.ts`, `apps/admin/public/app.js`)
   - **Causa 1:** campo `ghlStageMapping` faltaba en tipo TypeScript de `serializeGhlCampaign()`
     - Fix: Usar `Prisma.GhlCampaignGetPayload<{}>` para type safety completa
   - **Causa 2:** enviando `ghlStageMapping` con valores `undefined` causaba error de validación
     - Fix: Solo incluir `ghlStageMapping` en payload si `connectedStageId` tiene valor
   - Mejorado manejo de errores en frontend para distinguir errores de red vs errores de API

**Cómo funciona ahora:**
- Usuario configura solo 1 campo: "GHL Connected Stage ID" (típicamente el ID del stage "Contacted")
- Ese mismo ID se usa automáticamente para:
  - ✅ Cuando el vendedor contesta (`transfer_success`)
  - ✅ Cuando va a buzón del cliente (`voicemail`)
- Ambos casos significan "contactamos al cliente", por eso van al mismo stage

**Archivos modificados:**
- `apps/api/src/lib/ghl-campaigns.ts` - Tipos y parsing de stage mapping
- `apps/api/src/lib/sentiment.ts` - Detección de voicemail
- `apps/api/src/server.ts` - Validación y serialización
- `apps/admin/public/index.html` - UI simplificado
- `apps/admin/public/app.js` - Lógica de formulario
- `apps/api/prisma/migrations/20260512175621_add_ghl_stage_mapping/` - Migración DB

**Commits relevantes:**
- `dee4cf9` feat: add flexible stage mapping for GHL pipeline management
- `d425a07` refactor: simplify stage mapping to only transfer_success and voicemail
- `a985bf7` refactor: improve admin UI labels using GHL terminology
- `a27d049` refactor: use GHL stage names in placeholders instead of IDs
- `5a4645a` refactor: simplify to single GHL Connected Stage ID field
- `113a836` refactor: improve field layout with clear section headers
- `8a683c2` fix: resolve 'Failed to fetch' error when saving campaigns
- `2cdefd6` fix: add proper error handling for campaign update endpoint
- `98239c1` fix: remove non-existent ghlTranscriptFieldId field from code
- `e619eef` refactor: simplify Connected Stage ID help text
- `7933836` fix: make Lab dashboard link environment-aware

---

## [0.2.0] - 2026-02-17

### Reorganizado
- Proyecto adoptado como base principal para Voice Agent MVP
- Auditoría técnica completada (Julia + Codex)
- Documentación consolidada

### Identificado (Gaps)
- Prompt actual pide confirmación antes de transfer (debe ser inmediato)
- Webhooks sin verificación de firma
- Sin rate limiting ni auth en endpoints
- KPIs no calculan tiempo saludo→transfer

### Próximo
- Fase 0: Ajustar prompt para transfer sin preguntar

---

## [0.1.0] - 2026-02-06

### Inicial (Ale)
- Backend Express + TypeScript
- Prisma schema (Lead, CallAttempt, Event)
- Integración VAPI para llamadas outbound
- Webhooks Twilio/VAPI
- Lab UI para pruebas
- Dashboard básico

### Configuración
- Assistant VAPI configurado (gpt-4o-mini + ElevenLabs)
- Número Twilio importado a VAPI
- Deploy en Railway
