# Changelog

Todos los cambios notables en este proyecto serán documentados aquí.

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
- `d5b64d3` fix: run Prisma migrations on Railway deploy
- `62e53d8` fix: invert admin API detection logic to default to production
- `1758d79` fix: force admin deploy with comment update
- `0b24161` fix: ensure Lab and Dashboard production use correct API URLs

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
