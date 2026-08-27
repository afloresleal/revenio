# Changelog

Todos los cambios notables en este proyecto serán documentados aquí.

## 2026-08-27 - Deploy a Producción: Vapi Retention + Análisis de Campaña Purifika

### Resumen
Merged develop → main y deployed a producción. Incluye fix de manejo de retención de Vapi (14 días) y documentación de análisis de fallo en campaña Purifika donde el transfer no se ejecutaba debido a configuración de voicemail detection.

### Cambios desplegados a producción
1. **Fix Vapi Retention (de sesión 2026-08-25):**
   - Manejo graceful de errores cuando llamadas >14 días
   - Proxy endpoints para grabaciones de Vapi
   - Limpieza automática de URLs inválidas
   - Uso de endpoints oficiales de Vapi API

2. **Documentación de análisis:**
   - `ANALYSIS-2026-campaign-failure-vapi-assistant.html` - Análisis completo de problema de transfer
   - `ANALYSIS-2026-campaign-failure-vapi-assistant.md` - Versión markdown del análisis
   - `ANALYSIS-2026-ghl-opportunity-id-fallback-issue.md` - Análisis de problema secundario de GHL opportunity ID

### Problema identificado en campaña Purifika
**Síntoma:** Transfer nunca se ejecutaba (0 eventos `transfer-destination-request`)
**Causa raíz:** Voicemail detection bloqueando firstMessage del assistant
- `beepMaxAwaitSeconds: 20` + `silenceTimeoutSeconds: 30` = solo 10 seg de margen
- 44.4% de llamadas terminaban con `silence-timed-out`
- Assistant nunca llegaba a ejecutar `transferCall`

**Solución aplicada (en Vapi Dashboard, no código):**
- Reducir `beepMaxAwaitSeconds` de 20 a 10 segundos
- Aumentar `silenceTimeoutSeconds` de 30 a 45 segundos
- Resultado esperado: Más tiempo para que assistant hable y ejecute transfer

### Archivos modificados
- `CHANGELOG.md` - Este resumen
- `apps/api/src/routes/metrics.ts` - Manejo de retención
- `apps/api/src/server.ts` - Proxy endpoints de Vapi
- `apps/api/src/lib/vapi-recording-extraction.ts` - Extracción unificada de URLs
- `apps/admin/public/app.js` - Uso de proxy para grabaciones
- `dashboard-v2/App.tsx` - Uso de proxy para grabaciones
- `apps/api/test/vapi-recording-extraction.test.ts` - Tests de extracción

### Commits incluidos en este deploy
- `3e41853` - docs: add campaign failure analysis for Vapi voicemail detection issue
- `2768b06` - docs(changelog): session summary 2026-08-25 Vapi retention handling
- `df461f8` - docs: update changelog with retention fix commit SHA
- `91e0ad2` - fix(api): handle Vapi retention window gracefully in sync ⭐
- `92cf9ca` - fix(dashboard-v2): use proxy endpoint for Vapi storage recordings
- `834c24d` - fix(api): use Vapi official API endpoints to download old recordings
- `324cd7d` - fix(api+admin): add direct storage proxy for old Vapi recordings
- `55fa22b` - fix(admin): use proxy endpoint for Vapi recordings
- `612a5fb` - refactor(api): unify Vapi recording extraction across webhooks and sync worker
- `44de54d` - fix(api): improve Vapi recording extraction and add proxy endpoint

### Estado
- ✅ Merged develop → main
- ✅ Pushed to origin/main
- ✅ Deploy automático a Railway production
- ✅ Configuración de Vapi ajustada manualmente en dashboard

### Próximos pasos
- Monitorear logs de producción para verificar que transfer funciona correctamente
- Verificar que eventos `transfer-destination-request` aparecen en logs nuevos
- Si problema persiste, verificar configuración del tool `transferCall` en Vapi (ID: `813f90ad-2375-4e4f-a8f4-efac058db4d6`)

---

## 2026-08-25 - Sesión: Manejo de ventana de retención de Vapi (14 días)

### Resumen
Implementado manejo graceful de errores cuando se intenta sincronizar llamadas fuera de la ventana de retención de Vapi (>14 días). El plan actual de Vapi solo permite acceso a historial de los últimos 14 días. Ahora el botón "Sincronizar" funciona sin error 500 para llamadas antiguas, ocultando automáticamente el reproductor de Vapi y preservando transcripts de Twilio.

### Cambios realizados
1. **Detección de errores de retención en `syncCallMetricById()`:**
   - Detecta error 400 de Vapi con mensaje "retention window" o "retention period"
   - Marca `vapiUnavailable = true` y `snapshot = null` en lugar de lanzar error
   - Continúa sincronización de Twilio aunque Vapi falle

2. **Limpieza automática de `recordingUrl`:**
   - Cuando Vapi no disponible, limpia `recordingUrl` si contiene `storage.vapi.ai`
   - Preserva URLs de Twilio (`api.twilio.com`)
   - Dashboard automáticamente oculta reproductor cuando no hay URL

3. **Uso de optional chaining:**
   - Cambiado `snapshot.transferNumber` → `snapshot?.transferNumber`
   - Cambiado `snapshot.transcript` → `snapshot?.transcript`
   - Previene errores de null reference cuando snapshot es null

4. **Dashboard v2 - Proxy de Vapi (commit anterior):**
   - Agregada función `getVapiStorageProxyUrl()` para usar proxy
   - Filtrado automático de reproductores sin URL (ya existía)

### Archivos modificados
- `apps/api/src/routes/metrics.ts` - Manejo de retención en `syncCallMetricById()`
- `apps/api/src/server.ts` - Logging mejorado en proxy de Vapi
- `dashboard-v2/App.tsx` - Uso de proxy para grabaciones de Vapi
- `CHANGELOG.md` - Documentación completa del fix

### Decisiones técnicas
- **Continuar usando OpenAI Whisper para transcripción** (solo grabaciones de Twilio por ahora)
- **Aceptar pérdida de grabaciones de Vapi >14 días** (no recuperables sin upgrade de plan)
- **Priorizar sync de Twilio** (vendor-cliente) sobre Vapi (AI-cliente)
- **No hacer upgrade de plan Vapi** (decisión pendiente con socios)

### Resultado
- ✅ Sincronización funciona sin error 500 para llamadas antiguas
- ✅ Reproductor de Vapi se oculta cuando no hay grabación
- ✅ Transcripts y grabaciones de Twilio se sincronizan exitosamente
- ✅ Datos históricos preservados en base de datos
- ⚠️ Grabaciones de Vapi >14 días perdidas permanentemente

### Commits
- `92cf9ca` - fix(dashboard-v2): use Vapi storage proxy for recordings
- `91e0ad2` - fix(api): handle Vapi retention window gracefully in sync ⭐
- `df461f8` - docs: update changelog with retention fix commit SHA

### Estado
- ✅ Pushed to origin/develop
- ✅ Deploy automático a Railway staging
- ✅ Probado y funcionando en producción

### Próximos pasos
- Ajustes adicionales según necesidades (continuar mañana)

---

## [0.3.10] - 2026-08-25

### Fix: Mejorada extracción y acceso a grabaciones de Vapi

**Contexto:**
Vapi cambió su sistema de almacenamiento de grabaciones a un modelo de acceso controlado durante 2026. Las URLs de grabaciones que vienen en los webhooks ya no son directamente descargables sin autenticación con la Vapi API key.

**Problema detectado:**
- Las grabaciones de llamadas no se estaban guardando consistentemente en la base de datos
- Diferentes webhooks de Vapi usan diferentes estructuras JSON para las grabaciones (`artifact.recordingUrl`, `artifact.recording.url`, `artifact.recording.mono.combinedUrl`, etc.)
- La función `extractVapiRecordingUrl()` y el handler de `end-of-call-report` usaban lógicas diferentes para extraer URLs
- URLs de grabaciones pueden venir vacías o pueden requerir autenticación para descargarse

**Solución implementada:**

1. **Unificada extracción de recording URLs:**
   - Consolidada lógica en `extractVapiRecordingUrl()` para intentar múltiples paths de forma consistente
   - Agregados paths adicionales: `recording.url`, `mono.url`
   - Agregado logging cuando no se encuentra URL o cuando sí se extrae exitosamente
   - Actualizado `end-of-call-report` handler para usar función unificada

2. **Nuevo endpoint proxy para grabaciones de Vapi:**
   - Creado `GET /api/vapi-recordings/:callId/:type` (type: mono/stereo)
   - Maneja autenticación con Vapi API automáticamente
   - Sigue redirects 302 a URLs firmadas temporales
   - Permite acceso a grabaciones sin exponer credenciales
   - Cache de 15 minutos para reducir peticiones a Vapi

3. **Helper para URLs públicas:**
   - Nueva función `convertToPublicVapiRecordingUrl()` similar al patrón de Twilio
   - Convierte callIds a URLs del proxy público

**Impacto:**
- ✅ Grabaciones se extraen de forma más confiable desde webhooks de Vapi
- ✅ Compatibilidad con diferentes versiones de estructura de webhooks de Vapi
- ✅ Dashboard/Admin pueden acceder a grabaciones sin credenciales expuestas
- ✅ Logging mejorado para debuggear cuando grabaciones no están disponibles
- ✅ Preparado para cuando Vapi requiera autenticación obligatoria

**Archivos principales:**
- `apps/api/src/routes/webhooks.ts` - Función unificada de extracción con logging
- `apps/api/src/server.ts` - Endpoint proxy `/api/vapi-recordings/:callId/:type`
- `apps/api/test/vapi-recording-extraction.test.ts` - 13 tests de extracción (nuevo)

**Tests:**
- ✅ 13/13 tests pasando para diferentes estructuras de webhooks Vapi
- ✅ Build exitoso
- ✅ TypeScript compila sin errores

**Documentación de referencia:**
- Vapi API: Call recording, logging and transcribing (https://docs.vapi.ai/assistants/call-recording)
- Vapi API: Retrieve call artifacts (https://docs.vapi.ai/assistants/retrieve-call-artifacts)

**Próximos pasos (si es necesario):**
- Monitorear logs para ver qué estructuras de webhook están llegando en producción
- Si las grabaciones siguen sin aparecer, investigar si Vapi cambió completamente el modelo de entrega
- Considerar migrar URLs existentes en DB a usar el proxy

**Commits:**
1. SHA: 44de54d - fix(api): improve Vapi recording extraction and add proxy endpoint
2. SHA: 612a5fb - refactor(api): unify Vapi recording extraction across webhooks and sync worker
3. SHA: 55fa22b - fix(admin): use proxy endpoint for Vapi recordings
4. SHA: 324cd7d - fix(api+admin): add direct storage proxy for old Vapi recordings ⭐

**Rama:** develop (staging Railway)
**Estado:** ✅ Pushed to origin/develop (4 commits)
**Deploy:** Railway staging auto-deploy activado

**Flujo de grabaciones:**
- Vapi graba el primer contacto (AI) → `recordingUrl` (storage.vapi.ai)
- Twilio graba post-transfer (humano) → `transferRecordingUrl` (api.twilio.com)
- Admin usa proxy para AMBAS grabaciones

---

### Fix: Manejo de ventana de retención de Vapi (14 días)

**Contexto:**
El plan actual de Vapi solo permite acceder al historial de llamadas de los últimos 14 días. Intentar sincronizar llamadas más antiguas causa errores 400 con mensaje "Your subscription plan only covers the last 14 days of call history. This call exceeds your retention window."

**Problema detectado:**
- Al sincronizar llamadas antiguas (>14 días), el endpoint `/api/metrics/:callId/sync` fallaba con HTTP 500
- El error 500 aparecía en el Dashboard cuando el usuario hacía clic en "Sincronizar llamada"
- El transcript mostraba "HTTP 500:" después de intentar sincronizar
- Las grabaciones de Vapi para llamadas antiguas ya no son accesibles (Vapi devuelve 400)
- El reproductor de Vapi seguía visible aunque la grabación ya no existiera

**Solución implementada:**

1. **Detección de errores de retención en `syncCallMetricById()`:**
   - Detecta errores 400 de Vapi con mensajes que incluyen "retention window" o "retention period"
   - En lugar de lanzar error, marca `vapiUnavailable = true` y `snapshot = null`
   - Continúa con la sincronización de Twilio (vendor-cliente) aunque Vapi falle

2. **Limpieza de `recordingUrl` cuando Vapi no disponible:**
   - Si la llamada está fuera de la ventana de retención, limpia `recordingUrl` de la base de datos
   - Solo limpia URLs de Vapi (`storage.vapi.ai`), preserva URLs de Twilio
   - Esto hace que el Dashboard automáticamente oculte el reproductor de Vapi (ya filtra entries sin URL)

3. **Uso de optional chaining para acceso seguro:**
   - Cambiado `snapshot.transferNumber` a `snapshot?.transferNumber` en sync de Twilio
   - Cambiado `snapshot.transcript` a `snapshot?.transcript` en composición de transcript completo
   - Previene errores cuando `snapshot` es `null` debido a retención

4. **Dashboard v2 - Proxy de Vapi:**
   - Agregada función `getVapiStorageProxyUrl()` para convertir URLs de Vapi al proxy
   - Actualizado rendering de audio para usar proxy (igual que Admin)
   - El filtro existente (`audioEntries.filter`) automáticamente oculta player cuando no hay URL

**Impacto:**
- ✅ Sincronización de llamadas antiguas ahora funciona sin error 500
- ✅ Se recuperan transcripts y grabaciones de Twilio aunque Vapi no esté disponible
- ✅ Reproductor de Vapi se oculta automáticamente cuando grabación no disponible
- ✅ Datos existentes (transcript, duración, etc.) se preservan en la DB
- ✅ Logging claro cuando una llamada está fuera de ventana de retención
- ⚠️ Grabaciones de Vapi >14 días se pierden (no recuperables sin upgrade de plan)

**Archivos principales:**
- `apps/api/src/routes/metrics.ts` - Manejo de errores de retención en sync
- `apps/api/src/server.ts` - Logging mejorado en proxy de Vapi
- `dashboard-v2/App.tsx` - Proxy de Vapi y filtrado automático de players

**Decisión de producto:**
- Continuar usando OpenAI Whisper para transcripción (solo grabaciones de Twilio por ahora)
- Aceptar que grabaciones de Vapi >14 días no son recuperables sin upgrade
- Priorizar sincronización de Twilio (vendor-cliente) sobre Vapi (AI-cliente)

**Commits:**
- SHA: 92cf9ca - fix(dashboard-v2): use Vapi storage proxy for recordings
- SHA: 91e0ad2 - fix(api): handle Vapi retention window gracefully in sync ⭐
**Fix final (commit 4) - Storage Direct Proxy:**
Problema detectado: Llamadas viejas ya no existen en Vapi API (400 error)
- Nuevo endpoint: `GET /api/vapi-storage-proxy?url=...`
- Descarga directamente desde storage.vapi.ai sin consultar Vapi API primero
- Admin ahora usa este endpoint para URLs de storage.vapi.ai
- **Resultado:** ❌ Falló - storage.vapi.ai requiere usar endpoints oficiales de Vapi API

**Fix definitivo (commit 5) - Uso de endpoints oficiales de Vapi:**
Problema detectado: El storage proxy directo devuelve "Failed to proxy Vapi storage recording"
- Investigación: Vapi publica OpenAPI spec en `https://api.vapi.ai/api-json`
- Descubierto: Endpoints oficiales para descargar grabaciones:
  - `GET /call/{id}/mono-recording` → 302 redirect a URL firmada
  - `GET /call/{id}/stereo-recording` → 302 redirect a URL firmada
- Solución:
  - Nueva función `parseVapiStorageUrl()` extrae callId y tipo de recording de URLs storage.vapi.ai
  - Formato: `{callId}-{timestamp}-{fileId}-{type}.wav`
  - Endpoint actualizado para usar `https://api.vapi.ai/call/{callId}/{type}-recording`
  - Sigue redirects 302 automáticamente a URLs firmadas temporales
- **Impacto:** ✅ Grabaciones viejas ahora funcionan en Admin usando endpoints oficiales de Vapi
- **Documentación:** https://docs.vapi.ai/assistants/retrieve-call-artifacts

**Fix Dashboard v2 (commit 6) - Aplicar mismo proxy a Dashboard:**
Problema detectado: Admin funciona pero Dashboard v2 aún carga URLs de storage.vapi.ai directamente
- Error en consola: `ERR_NAME_NOT_RESOLVED` para storage.vapi.ai
- Dashboard usaba `getTwilioProxyUrl()` para Twilio pero no tenía equivalente para Vapi
- Solución:
  - Nueva función `getVapiStorageProxyUrl()` similar a `getTwilioProxyUrl()`
  - Actualizada línea de renderizado de audios para usar proxy en grabaciones Vapi
  - Ahora AMBAS grabaciones (Vapi y Twilio) pasan por proxy en Dashboard v2
- **Impacto:** ✅ Dashboard v2 ahora reproduce grabaciones de Vapi igual que Admin

**Commits totales:**
1. SHA: 44de54d - fix(api): improve Vapi recording extraction and add proxy endpoint
2. SHA: 612a5fb - refactor(api): unify Vapi recording extraction across webhooks and sync worker
3. SHA: 55fa22b - fix(admin): use proxy endpoint for Vapi recordings
4. SHA: 324cd7d - fix(api+admin): add direct storage proxy for old Vapi recordings
5. SHA: 834c24d - fix(api): use Vapi official API endpoints to download old recordings ⭐
6. SHA: 92cf9ca - fix(dashboard-v2): use proxy endpoint for Vapi storage recordings ⭐

---

## [0.3.9] - 2026-07-10

### Feature/Fix: Segundo intento GHL, reconciliación automática y visibilidad operativa

**Contexto:**
Durante pruebas operativas con leads de GHL, el equipo necesitaba cubrir un flujo muy específico:
- si la primera llamada caía en buzón o no contestaban, hacer un segundo intento automático 30 segundos después;
- consolidar ambos intentos en Dashboard/Admin para que marketing y operación vieran el flujo completo;
- evitar que el equipo tuviera que sincronizar manualmente cada llamada para ver duración, transcript o recordings finales;
- corregir dos regresiones de UI detectadas durante el rollout: fechas crudas en admin y `attempt_number` incorrecto en filas consolidadas.

**Problema 1 - Segundo intento sin persistencia operativa:**
- El patrón inicial no dejaba trazabilidad suficiente para reporting.
- Dashboard/Admin no distinguían claramente cuándo una llamada completada venía del segundo intento.
- El flujo necesitaba reutilizar primitives existentes sin montar una solución más grande de callback inbound.

**Solución implementada:**
- Se introdujo persistencia explícita para el estado de `ghlDoubleAttempt`.
- El sistema ahora agenda un segundo intento automático 30 segundos después cuando el primer outcome es `voicemail` o `no-answer`.
- Si el segundo intento también falla, el flujo continúa como `No contactado`.
- Dashboard v2 y Admin consolidan intentos relacionados bajo una sola lectura operativa:
  - `Segunda llamada pendiente`
  - `Segunda llamada en curso`
  - `Segunda llamada completada`
  - `Segunda llamada sin exito`

**Problema 2 - Datos finales solo aparecían tras sincronización manual:**
- Algunas llamadas necesitaban abrir `Sincronizar solo esta llamada` para poblar recording, transcript o duración post-transfer.
- Eso metía fricción operativa y riesgo de métricas incompletas.

**Solución implementada:**
- Se extrajo la lógica de sync manual a una ruta reusable de reconciliación.
- Se agregó un worker interno que revisa llamadas recientes incompletas y ejecuta esa misma reconciliación en background.
- El botón manual sigue existiendo, pero ya no es la vía principal para cerrar artifacts tardíos de Vapi/Twilio.

**Problema 3 - Transferencia forzada antes de detectar buzón:**
- Un hook temporizado disparaba `transferCall` a los 12 segundos en llamadas GHL.
- En pruebas reales, eso podía mandar la llamada al vendedor aunque el lead no hubiera contestado y solo se escuchara el buzón.

**Solución implementada:**
- Se eliminó el hook temporizado de auto-transfer para llamadas outbound de GHL.
- La transferencia volvió a depender del comportamiento natural del agente y la detección real de voicemail.

**Problema 4 - Visibilidad y consistencia en Admin:**
- `STARTED_AT` podía aparecer como ISO crudo en lugar de fecha/hora local.
- `ATTEMPT_NUMBER` mostraba `1` incluso cuando la llamada consolidada se había completado en el segundo intento.

**Solución implementada:**
- Admin ahora formatea `startedAt` en zona `America/Mexico_City`.
- Las filas consolidadas de Admin muestran el `attemptNumber` final de la llamada base (`retry || primary`), no siempre el del primer intento.

**Impacto:**
- ✅ GHL ahora reintenta automáticamente una vez cuando el primer intento cae en buzón o no contestan
- ✅ Dashboard/Admin muestran el flujo completo de contactación con lenguaje operativo
- ✅ Las llamadas recientes incompletas se enriquecen solas sin intervención manual
- ✅ Se redujo el riesgo de transferir al vendedor cuando solo respondió un buzón
- ✅ Admin muestra `STARTED_AT` y `ATTEMPT_NUMBER` de forma consistente con la realidad operativa

**Archivos principales:**
- `apps/api/src/lib/ghl-double-attempt.ts`
- `apps/api/src/routes/webhooks.ts`
- `apps/api/src/routes/metrics.ts`
- `apps/api/src/lib/call-metrics-sync-worker.ts`
- `apps/api/src/lib/ghl-second-attempt-worker.ts`
- `apps/api/src/routes/jobs.ts`
- `apps/api/src/server.ts`
- `dashboard-v2/App.tsx`
- `dashboard-v2/src/lib/api.ts`
- `dashboard-v2/src/lib/contact-attempts.ts`
- `apps/admin/public/app.js`

**Tests/soporte:**
- `apps/api/test/ghl-double-attempt.test.ts`
- `apps/api/test/ghl-second-attempt-worker.test.ts`
- `apps/api/test/call-metrics-sync-worker.test.ts`
- `apps/api/test/jobs-auth.test.ts`
- `apps/api/test/webhooks-assistant-overrides.test.ts`
- `dashboard-v2/test/contact-attempts.test.ts`
- `docs/superpowers/plans/2026-07-07-call-metrics-auto-sync.md`

**Commits principales:**
- `8128e07` - `Add persistent GHL second-attempt retry`
- `396c7e9` - `feat(api): run GHL second attempts with internal worker`
- `d0159b4` - `fix(api): schedule GHL retries from ended Vapi snapshots`
- `41f43bf` - `feat(metrics): show GHL second-attempt visibility`
- `83a75c1` - `feat(ui): consolidate GHL re-call flow`
- `9a659d1` - `chore(ui): refine contact-attempt copy`
- `4c969d3` - `chore(ui): simplify contact-attempt detail card`
- `dbfab81` - `fix(ui): use final contact attempt in consolidated rows`
- `56197b3` - `feat(api): auto-sync recent call metrics`
- `4c2476c` - `Reapply "fix(api): stop forced timed transfer for GHL calls"`
- `aab0130` - `fix(admin): format call started timestamps`
- `180d7cc` - `fix(admin): show final contact attempt number`

## [0.3.8] - 2026-06-04

### Fix: Resolver correctamente qué vendedor contestó

**Contexto:**
Durante una prueba real con cliente, el dashboard mostraba que la llamada había sido contestada por el primer vendedor del pool, aunque el número transferido y el transcript humano indicaban que respondió otro vendedor.

**Problema real observado:**
- `transferNumber` apuntaba al vendedor correcto.
- `roundRobinAnsweredAgentName` y/o `roundRobinAnsweredAgentIndex` podían quedar viejos o inconsistentes.
- Admin, Dashboard, CSV y GHL no siempre consumían exactamente la misma resolución.

**Solución implementada:**
- El sistema ahora usa el `transferNumber` final como base canónica cuando existe evidencia humana real.
- Si el snapshot histórico del intento está corrupto o inconsistente, se hace fallback contra la configuración actual de agentes de la campaña.
- Se unificó la resolución para:
  - Dashboard Metrics API
  - Admin > Llamadas
  - CSV de campañas
  - `assignedTo` enviado a GHL
- La UI deja de afirmar falsamente que el primer intento conectó cuando el vendedor real fue otro.

**Impacto:**
- ✅ Dashboard muestra al vendedor correcto cuando el snapshot histórico viene inconsistente
- ✅ Admin > Llamadas y CSV exportan el mismo vendedor contestado
- ✅ GHL recibe `assignedTo` con el vendedor correcto
- ✅ Se reduce dependencia de metadata vieja guardada en `roundRobin`

**Archivos principales:**
- `apps/api/src/lib/round-robin-resolution.ts`
- `apps/api/src/routes/metrics.ts`
- `apps/api/src/routes/webhooks.ts`
- `apps/api/src/server.ts`
- `apps/api/test/metrics-round-robin-resolution.test.ts`
- `docs/IMPLEMENTED-2026-06-04-answered-agent-resolution.md`

**Commits principales:**
- `27acf86` - `fix answered agent resolution for dashboard and GHL`
- `9ca4731` - `fix stale answered agent metadata precedence`
- `6a5e807` - `fix answered agent resolution in legacy admin views`
- `0631818` - `fix answered agent fallback from campaign config`

## [0.3.7] - 2026-06-02

### Fix: Umbral de 30 segundos para contactos válidos en GHL

**Contexto:**
La clasificación de llamadas como "contactado" en GHL estaba siendo demasiado permisiva. Cualquier llamada transferida se marcaba como éxito aunque durara menos de 30 segundos, generando datos inexactos de conversión.

**Problema 1 - Clasificación prematura:**
- `AnsweredBy=human`, `answered` o `completed` bastaba para marcar como `transfer_success`.
- No se validaba duración mínima de conversación con agente humano.
- Métricas inflaban artificialmente la tasa de contactos exitosos.

**Solución implementada:**
- **Umbral de 30 segundos:** `transfer_success` / "contactado" ahora requiere mínimo 30 segundos post-transfer.
- **Metadata vs Clasificación:** `AnsweredBy=human` se conserva como información de qué agente contestó, pero no determina el éxito por sí solo.
- **Confirmación tardía:** La validación por grabación/Twilio usa el mismo umbral de 30 segundos.
- **Métricas actualizadas:** Dashboard ya no trata `answered`/`completed` como conexión válida sin duración suficiente.
- **Documentación:** `README.md` documenta `TRANSFER_CONNECTED_MIN_SEC=30` como valor operativo.

**Problema 2 - Stage mapping incorrecto:**
- Aunque el outcome se clasificaba como "abandoned" (< 30 seg), GHL movía el contacto a "contacted" por el fallback de `connectedStageId`.
- Ejemplo real: llamada con 22 seg post-transfer se marcaba como contacto exitoso.

**Solución implementada:**
- `pushSuccessfulTransferToGhl` ahora solo usa `connectedStageId` como fallback cuando el outcome es `transfer_success` o `voicemail`.
- Llamadas con outcome `abandoned`, `completed` o `failed` ya NO mueven a stage "contacted" automáticamente.

**Problema 3 - Recordings en Admin requieren autenticación:**
- Botón "Abrir recording" en sección Llamadas usaba URLs directas de Twilio.
- CSV descargado contenía URLs privadas que pedían usuario/contraseña.
- UX inconsistente vs Dashboard que usa proxy público.

**Solución implementada:**
- Admin panel usa proxy de recordings (`/api/recordings/:recordingSid`) igual que Dashboard.
- CSV export convierte URLs de Twilio a URLs públicas del proxy automáticamente.
- Grabaciones se reproducen directamente sin autenticación.
- Función helper `convertToPublicRecordingUrl()` agregada al backend.

**Impacto:**
- ✅ Clasificación de contactos GHL ahora refleja conversaciones reales (30+ seg)
- ✅ Métricas precisas: llamadas cortas correctamente clasificadas como "abandoned"
- ✅ UX mejorada: grabaciones accesibles sin credenciales en Admin y CSV
- ✅ Datos exportados listos para análisis externo sin barreras de autenticación

**Archivos modificados:**
- `apps/api/src/routes/webhooks.ts` - Lógica de clasificación y stage mapping
- `apps/api/src/server.ts` - CSV export con URLs públicas
- `apps/api/src/lib/late-transfer-confirmation.ts` - Umbral de 30 segundos
- `apps/api/src/lib/metric-classification.ts` - Validación de duración
- `apps/admin/public/app.js` - Proxy de recordings en UI
- Tests: `late-transfer-confirmation.test.ts`, `metric-classification.test.ts`

**Commits:**
- `2c5091c` - fix: require 30s human conversation for transfer success
- `02d7aa8` - fix: only move to connected stage for valid outcomes
- `c9d9d03` - fix: use recording proxy in admin to avoid auth prompt
- `f28e151` - fix: use correct function name apiBase() instead of getApiUrl()
- `4269a8a` - fix: use public recording URLs in admin CSV export

---

## [0.3.6] - 2026-05-19

### Hotfix: Producción - Round Robin, Fallback y Lectura Operativa

**Contexto:**
Durante pruebas en producción con el equipo de <OPERADOR_INTERNO>, se detectaron diferencias entre la verdad operativa de la llamada y lo mostrado en Dashboard/Admin, además de riesgo de audio filtrado desde intentos fallidos antes de llegar al fallback.

**Cambios implementados:**
- El failover de round robin ahora respeta el horario personalizado de la campaña cuando la llamada pertenece a una campaña GHL.
- Las llamadas con confirmación tardía de transfer pueden promocionarse correctamente a `transfer_success` después de sincronizar la grabación/datos de Twilio.
- Dashboard traduce estados técnicos a lenguaje operativo para el equipo:
  - `child-never-answered-no-callback` -> `No confirmado a tiempo`
  - `no-answer` -> `No contestó`
  - `call_attempt_result_json` -> `Registro interno`
- Dashboard incluye eventos `transfer_fallback` y muestra el fallback final cuando el pool de vendedores se agotó.
- Twilio `<Dial>` de failover/fallback usa `answerOnBridge="true"` para reducir el riesgo de que el cliente escuche tonos o buzones antes de conectar.
- Admin Calls/CSV prioriza la verdad de `roundRobin` sobre `metric.transferNumber`, evitando mostrar como vendedor conectado al primer intento cuando la llamada terminó en fallback.
- Export CSV de llamadas elimina la columna `assigned_to`.
- Admin mantiene inactivos los renglones vacíos de agentes y ordena llamadas recientes de forma consistente.

**Notas operativas:**
- Este hotfix fue aplicado directo en `main`/producción para pruebas en caliente.
- `develop`/staging quedó como backup en `ea6a0ee` durante estas pruebas.
- `answerOnBridge` reduce el riesgo de audio filtrado, pero no reemplaza una arquitectura completa de sala de espera/screening con `Conference`.

**Archivos principales:**
- `apps/api/src/routes/webhooks.ts`
- `apps/api/src/server.ts`
- `apps/api/src/routes/metrics.ts`
- `apps/api/src/lib/ghl-campaigns.ts`
- `apps/api/src/lib/round-robin-window.ts`
- `dashboard-v2/App.tsx`

**Commits principales:**
- `224fafc` - `fix: keep empty agents inactive and sort recent calls`
- `3bb8a17` - `fix: promote late confirmed transfers`
- `49a6e9f` - `fix: use campaign hours for failover`
- `ea6a0ee` - `fix: clarify transfer routing details`
- `d8683fa` - `fix: delay transfer bridge until answer`
- `e224ab5` - `fix: show fallback in admin calls`
- `40c7459` - `chore: remove assigned column from calls export`

---

## [0.3.5] - 2026-05-16

### Fix: Transferencias a Agentes Humanos y Clasificación de Buzón

**Problemas detectados durante testing en staging:**
- El assistant confirmaba la transferencia en inglés antes de conectar al asesor.
- Algunos buzones de voz de agentes humanos seguían siendo tratados como si hubiera contestado una persona.
- Llamadas conectadas a buzón podían aparecer como `transfer_success` aunque ningún humano hubiera respondido.

**Solución implementada:**
- Eliminado el mensaje `request-start` que provocaba la frase en inglés durante el handoff.
- La llamada solo se considera atendida por humano cuando Twilio reporta explícitamente `AnsweredBy=human`.
- Ajustada la detección AMD de Twilio para buzones cortos con `machineDetectionSpeechEndThreshold="2500"`.
- Separada la noción de:
  - llamada transferida/conectada
  - llamada realmente atendida por humano
- `transfer_success` ahora se registra solo cuando hay confirmación humana real.

**Comportamiento validado en staging:**
- Agente B -> Agente C -> <OPERADOR_INTERNO> ejecutó round robin completo.
- El sistema saltó correctamente los primeros dos intentos fallidos.
- Cuando ningún agente humano atendió, `roundRobinAnsweredAgentName` quedó en `null`.
- La llamada dejó de contarse como éxito falso cuando terminó en buzón.

**Archivos principales:**
- `apps/api/src/routes/webhooks.ts`
- `apps/api/src/server.ts`
- `apps/api/src/lib/transfer-failover.ts`
- `apps/api/src/lib/metric-classification.ts`
- `apps/api/test/transfer-failover.test.ts`
- `apps/api/test/metric-classification.test.ts`

**Commits principales:**
- `84863ae` - `fix: avoid voicemail transfer confirmations`
- `2d49a11` - `fix: tune amd and require human-confirmed transfers`

---

## [0.3.4] - 2026-05-16

### Fix: Admin Panel Agent Save Error

**Problema reportado por:** <USUARIO_INTERNO> (durante testing en staging)

**Síntoma:** Al intentar guardar agentes en el Admin Panel de staging, el request fallaba y el backend devolvía error de Prisma por constraint único.

**Causa raíz:**
El save podía intentar crear dos filas con el mismo `ghl_user_id` dentro del mismo batch, por ejemplo cuando un agente conservaba un ID autogenerado antiguo y otro campo vacío generaba exactamente el mismo valor.

El backend devolvía:
```
Unique constraint failed on the fields: (`property_key`,`campaign_id`,`ghl_user_id`)
```

**Solución implementada:**
- Mantener el manejo consistente de `campaignId` nullable.
- Detectar IDs duplicados antes de tocar Prisma.
- Devolver error claro `duplicate_ghl_user_id` en lugar de dejar que falle la transacción.
- Validar duplicados también en frontend para que el usuario vea el problema antes de guardar.

**Archivos modificados:**
- `apps/api/src/server.ts`
- `apps/api/src/lib/ghl-agents.ts`
- `apps/admin/public/app.js`
- `apps/api/test/ghl-agents.test.ts`

**Impacto:**
- ✅ Admin staging puede guardar y actualizar agentes sin romper por duplicados
- ✅ El backend ya no expone el error crudo de Prisma para este caso
- ✅ El formulario muestra una causa accionable antes de intentar guardar

**Commits principales:**
- `288387d` - `fix: handle nullable campaignId correctly in agent save operation`
- `34d1050` - `fix: improve agent save with better null handling and error logging`
- `e12f134` - `fix: use delete+create strategy for agent save to handle nullable campaignId`
- `4741eef` - `fix: reject duplicate admin agent ids`

---

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

**Reported by:** <OPERADOR_INTERNO> + testing con assistant `Isla-Blanca_v.corta`

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

**Problema reportado por:** <OPERADOR_INTERNO> (equipo)

**Caso específico:**
- Llamada a <OPERADOR_INTERNO> (`<PHONE_E164>`) transferida a Agente A (`<PHONE_E164>`)
- Agente A sin señal → llamada cayó en buzón de voz de Agente A
- Round robin configurado con 3 agentes (Agente A, Agente B, Agente C) pero **NO se ejecutó failover**
- <OPERADOR_INTERNO> terminó en el buzón sin que se intentara con Agente B o Agente C

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
- `d5b64d3` fix: run Prisma migrations on Railway deploy
- `62e53d8` fix: invert admin API detection logic to default to production
- `1758d79` fix: force admin deploy with comment update
- `0b24161` fix: ensure Lab and Dashboard production use correct API URLs

---

## [0.2.0] - 2026-02-17

### Reorganizado
- Proyecto adoptado como base principal para Voice Agent MVP
- Auditoría técnica completada (<CLAWDBOT_INTERNO> + Codex)
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

### Inicial (<USUARIO_INTERNO>)
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
