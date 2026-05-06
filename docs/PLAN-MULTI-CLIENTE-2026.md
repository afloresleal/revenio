# Plan de Crecimiento: Arquitectura Multi-Cliente
## Revenio — Mayo 2026

> **Estado actual:** Sistema funcional en producción para un solo cliente (Caribbean Luxury Homes / Casalba).
> **Objetivo:** Evolucionar el sistema para soportar múltiples clientes y campañas, con un panel de administración para el equipo de marketing.
> **Prioridad inmediata:** dejar listo un Admin separado de Lab para demos con GHL, sin depender de Railway ni cambios de código.

---

## Contexto: Cómo funciona hoy

Revenio es un sistema de llamadas outbound con IA. El flujo actual:

1. El sistema llama a un lead (prospecto)
2. Un agente de voz (VAPI) lo saluda y transfiere en <30 segundos
3. La llamada llega a un agente humano de ventas
4. Se registran métricas: duración, resultado, sentimiento, transcripción

**El problema:** parte de la configuración del sistema todavía vive en variables de entorno o en código. Para demos con clientes, eso no escala: Marina y su equipo deben poder crear campañas, seleccionar asistentes de Vapi, cargar vendedores humanos y configurar fallback desde un Admin operativo, sin pedir cambios técnicos.

**Avance ya iniciado:** la administración de vendedores humanos para GHL ya empezó a moverse a BD y a una interfaz temporal en Lab. La siguiente pieza crítica es crear un Admin separado, orientado al equipo de marketing, y mover ahí campañas, vendedores y fallback.

---

## Decisión operativa para demos GHL

Para demos con clientes, Revenio debe tener una sola fuente de verdad operativa:

- **Vapi:** solo conserva assistants, voces, prompts y Server URL.
- **GHL:** manda `campaignId`, lead y, cuando ya exista, `assignedTo`.
- **Revenio Admin/BD:** guarda campañas, IDs de Vapi, vendedores humanos y fallback final.
- **Revenio Lab:** queda para monitoreo, soporte interno, pruebas manuales y debugging.
- **Railway:** solo conserva secretos y configuración de infraestructura, no operación diaria de campañas.

Esto evita que el equipo tenga que entrar a Railway para cambiar números o agregar campañas, y evita que el equipo de marketing vea JSONs o herramientas técnicas.

---

## Routing de transferencia cuando GHL manda `assignedTo`

La llamada no debe elegir entre "vendedor asignado" o "round robin". El flujo correcto es una jerarquia:

1. **GHL crea o actualiza la oportunidad.**
2. **GHL asigna owner/vendedor** antes de enviar el webhook a Revenio, cuando el workflow lo permita.
3. **GHL manda webhook a Revenio** con `campaignId`, lead y `assignedTo`.
4. **Revenio busca la campaña en BD** usando `campaignId`.
5. **Revenio busca el vendedor asignado** comparando `assignedTo` contra el `GHL User ID` de los vendedores configurados en Admin.
6. **Primer intento:** si hay match, Revenio transfiere primero al vendedor asignado por GHL.
7. **Failover:** si el vendedor asignado no contesta, Revenio sigue con los demas vendedores activos del pool de esa campaña.
8. **Fallback final:** si ningun vendedor contesta, Revenio transfiere al fallback final, normalmente gerente de marketing.

Si `assignedTo` viene vacio o no coincide con ningun `GHL User ID`, Revenio empieza directamente con el pool de vendedores de la campaña. Si la campaña no tiene vendedores activos, usa fallback final si existe.

**Formula operativa:**

```
assignedTo de GHL -> resto del RR de la campaña -> fallback final
```

Esto permite respetar la asignacion de GHL sin perder la proteccion del round robin/failover cuando el vendedor asignado no responde.

---

## Jerarquía propuesta

```
Cliente  (ej: "Caribbean Luxury Homes")
  └── Campaña GHL  (ej: "isla-blanca-es", "nikki-ocean-en")
        ├── Config Vapi          → assistant ID, phone number ID, idioma, status
        ├── Config GHL           → Location ID visible; API key y pipeline/stage en avanzado si aplica
        ├── Vendedores humanos   → hasta 5 asesores con GHL User ID + teléfono
        └── Fallback final       → gerente de marketing si nadie contesta
```

Un cliente puede tener una o varias campañas. Cada campaña es independiente: tiene su propio assistant de Vapi, su número de salida, su pool de vendedores y su fallback final. Para GHL, la campaña se identifica por `campaignId` porque ese es el valor que llega en el webhook.

En real estate, una campaña puede representar una propiedad o desarrollo específico, por ejemplo `Isla Blanca ES`. Ese significado debe vivir en el **nombre de la campaña**, no en un campo adicional de propiedad. El dato operativo de GHL para recibir leads de esa campaña es `Location ID`.

La `GHL API key` no es necesaria para que GHL mande el webhook inicial a Revenio. Segun el alcance de KRP, se necesita por campaña/propiedad cuando Revenio haga el push post-llamada hacia GHL: asignar owner, mover stage y escribir transcript en el campo custom. Por eso debe quedar como dato avanzado, no como campo principal del alta de campaña.

---

## Separación Lab vs Admin

### Lab

Lab se conserva como herramienta interna para Ale/equipo técnico:

- monitorear llamadas;
- revisar respuestas y payloads;
- hacer pruebas manuales;
- validar IDs;
- diagnosticar eventos de Vapi/GHL/Twilio;
- ver JSONs cuando haga falta soporte.

Lab puede mantener vistas técnicas porque su audiencia es interna.

### Admin

Admin será la herramienta para Marina y su equipo:

- crear campañas;
- configurar Vapi Assistant ID y Phone Number ID;
- administrar vendedores humanos;
- configurar fallback final;
- generar instrucciones para GHL;
- revisar checklist de campaña lista para demo.

Admin no debe mostrar JSONs como interfaz principal. Debe usar formularios, tablas, estados claros, botones de copiar y lenguaje operativo.

---

## MVP recomendado antes del demo

Antes de hacer el modelo completo de clientes, conviene cerrar un MVP operativo en Admin:

1. **Campañas en BD**
   - Crear/editar campañas desde Admin.
   - Guardar `campaignId`, nombre, cliente, Vapi Assistant ID, Vapi Phone Number ID, idioma y status.
   - Activar/pausar campaña sin borrarla. Si está pausada, el webhook no debe disparar llamadas.
   - Guardar configuración GHL por campaña: Location ID como dato principal; API key secreta, Pipeline ID y Stage ID como datos avanzados cuando aplique el push post-llamada a GHL.
   - El webhook GHL debe buscar campañas en BD antes de usar variables/código.

2. **Agentes GHL en BD**
   - Ya iniciado.
   - Cada campaña tiene hasta 5 vendedores humanos.
   - Cada vendedor tiene nombre, `GHL User ID`, teléfono, prioridad y activo/inactivo.
   - Cada pool tiene fallback final, normalmente gerente de marketing.
   - Si GHL manda `assignedTo`, el vendedor con ese `GHL User ID` se intenta primero; despues siguen los demas vendedores activos.

3. **Test de llamada por campaña**
   - En Admin, elegir una campaña y llamar a un lead de prueba.
   - El usuario no debe pegar Assistant ID ni Phone Number ID cada vez.

4. **Checklist visible para operación**
   - Campaña activa.
   - GHL API key configurada cuando esa campaña necesite actualizar GHL post-llamada.
   - Location ID / Pipeline / Stage configurados cuando el workflow los requiera.
   - Assistant ID configurado.
   - Phone Number ID configurado.
   - Server URL esperado.
   - Al menos un vendedor activo.
   - Fallback final configurado.
   - Instrucciones de webhook GHL listas para copiar campo por campo.

Este MVP es suficiente para que Marina y su equipo operen demos sin Railway ni Lab.

---

## Entregable GHL por campaña

Cuando se cree o edite una campaña, Admin debe generar un entregable para el equipo de marketing. No debe ser solo un JSON técnico: en GHL la configuración se captura en el panel del workflow, en la acción **Webhook**, llenando Method, URL y filas de **Custom Data**.

El entregable debe mostrarse en formato operativo:

### Configuración de la acción Webhook

| Campo en GHL | Valor |
| --- | --- |
| Action name | `Webhook` o `Revenio - Crear llamada` |
| Method | `POST` |
| URL staging | `https://revenioapi-staging.up.railway.app/webhooks/gohighlevel` |
| URL production | `https://revenioapi-production.up.railway.app/webhooks/gohighlevel` |

### Custom Data

| Key | Value |
| --- | --- |
| `type` | `OpportunityAssignedTo` |
| `campaignId` | valor exacto creado en Admin, ej. `isla-blanca-es` |
| `locationId` | ID de la location de GHL |
| `id` | `{{ opportunity.id }}` |
| `assignedTo` | usuario asignado en GHL, ej. `{{ opportunity.assigned_to }}` o valor equivalente disponible |
| `contactId` | `{{ contact.id }}` |
| `firstName` | `{{ contact.first_name }}` |
| `lastName` | `{{ contact.last_name }}` |
| `phone` | `{{ contact.phone }}` |
| `email` | `{{ contact.email }}` |
| `pipelineId` | ID del pipeline |
| `pipelineName` | nombre del pipeline |
| `stageId` | ID del stage que dispara la llamada |
| `stageName` | nombre del stage |

### Validaciones que debe mostrar Admin

- `campaignId` debe coincidir exactamente con la campaña creada en Admin.
- `assignedTo` debe coincidir con el `GHL User ID` configurado en **Agentes GHL**.
- El webhook de Revenio debe estar despues del paso de asignacion en GHL si queremos respetar primero al vendedor asignado.
- `phone` debe venir en formato llamable. Si GHL guarda teléfonos locales, Revenio debe normalizarlos o el equipo debe corregir el dato antes del demo.
- Para staging, usar URL staging. Para cliente real, usar URL production.
- Después de guardar el webhook en GHL, probar con **Test Workflow** o una oportunidad real de prueba.

### Formato secundario para soporte tecnico

Admin no debe mostrar JSONs por defecto. Si en el futuro se agrega una vista JSON, debe estar escondida como opción de soporte tecnico, no como camino principal para marketing.

---

## Cambios al sistema

### 1. Base de datos

La visión completa agrega estos modelos. Para el MVP de demo podemos implementarlos de forma incremental y con nombres específicos de GHL cuando convenga.

**`Client`** — La organización o empresa cliente
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | string | ID interno |
| name | string | Nombre legible (ej: "Caribbean Luxury Homes") |
| slug | string único | Identificador URL-friendly |
| status | enum | `active` / `paused` / `inactive` |

**`Campaign`** — Una campaña dentro de un cliente
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | string | ID interno |
| clientId | FK → Client | Cliente al que pertenece |
| name | string | Nombre legible (ej: "Casalba Español") |
| campaignId | string único | Identificador que llega desde GHL (ej: `isla-blanca-es`) |
| ghlLocationId | string opcional | Location ID de GHL para esta campaña |
| ghlApiKey | string secreto opcional | API key de GHL para esta campaña; Admin no debe mostrarla después de guardarla |
| ghlPipelineId | string opcional | Pipeline ID esperado en GHL |
| ghlStageId | string opcional | Stage ID que dispara la llamada |
| status | enum | `active` / `paused` / `inactive` |

**`HumanAgent` / `GhlHumanAgent`** — Vendedor humano del pool de transferencia
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | string | ID interno |
| campaignId | FK → Campaign | Campaña a la que pertenece |
| name | string | Nombre del agente (ej: "Ana García") |
| ghlUserId | string | ID del usuario en GHL; debe coincidir con `assignedTo` |
| phoneNumber | string | Número E.164 (ej: `+525512345678`) |
| isActive | boolean | Si está disponible para recibir llamadas |
| sortOrder | integer | Orden de prioridad en el round-robin |

**`AgentPoolSetting`** — Ajustes del pool de vendedores
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | string | ID interno |
| campaignId | FK → Campaign | Campaña a la que pertenece |
| fallbackName | string | Nombre del fallback final, normalmente gerente de marketing |
| fallbackTransferNumber | string | Número E.164 del fallback final |

**`CampaignVapiConfig`** — Credenciales y configuración de VAPI
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | string | ID interno |
| campaignId | FK → Campaign | Campaña a la que pertenece |
| vapiAssistantId | string | ID del asistente de voz |
| vapiPhoneNumberId | string | ID del número de salida en VAPI |
| assistantName | string | Nombre legible del asistente (ej: "Brenda") |
| language | enum | `es` / `en` |

> Para el MVP no se recomienda guardar la API Key de Vapi por campaña. La API Key puede seguir como secreto de infraestructura. Lo que sí debe moverse a BD/UI son Assistant ID y Phone Number ID.

**Cambios a modelos existentes:**
- `Lead` → se agrega `campaignId` (opcional, para leads futuros)
- `CallMetric` → se agrega `campaignId` (para filtrar métricas por campaña)
- `CallAttempt` → se agrega `campaignId`

> Todos los cambios son retrocompatibles. Los registros existentes sin `campaignId` siguen funcionando.

---

### 2. API — Nuevos endpoints

Para el MVP de Admin se recomienda usar endpoints propios de admin. Lab puede seguir usando sus endpoints técnicos actuales.

**Clientes:**
```
GET    /api/admin/clients                     → Listar clientes
POST   /api/admin/clients                     → Crear cliente
GET    /api/admin/clients/:clientSlug         → Detalle del cliente
PUT    /api/admin/clients/:clientSlug         → Editar nombre/status
```

**Campañas:**
```
GET    /api/admin/ghl-campaigns                  → Listar campañas
POST   /api/admin/ghl-campaigns                  → Crear campaña
PUT    /api/admin/ghl-campaigns/:id              → Editar campaña
GET    /api/admin/ghl-campaigns/:id              → Detalle de campaña
```

**Configuración VAPI de una campaña:**
```
GET    /api/admin/ghl-campaigns/:id/config       → Obtener configuración
PUT    /api/admin/ghl-campaigns/:id/config       → Guardar configuración
POST   /api/admin/ghl-campaigns/:id/validate     → Validar Assistant ID + Phone Number ID
```

**Agentes humanos de una campaña:**
```
GET    /api/admin/ghl-agents                     → Listar agentes + fallback por campaña
PUT    /api/admin/ghl-agents                     → Guardar pool completo + fallback final
```

**Cambio en endpoints de llamada (retrocompatible):**

El webhook de GHL debe aceptar `campaignId` y resolver la campaña desde BD:

```json
// Antes (sigue funcionando)
{
  "vapi_api_key": "...",
  "vapi_assistant_id": "...",
  "round_robin_agents": [...]
}

// Después (nuevo flujo)
{
  "campaignId": "isla-blanca-es",
  "assignedTo": "ghl-user-id-del-vendedor",
  "lead": { "phone": "+52...", "name": "Juan" }
}
```

Si viene `campaignId`, la API carga la configuración desde BD. Si no existe en BD, puede usar el fallback actual de variables/código durante transición, pero el objetivo del demo es no depender de ese fallback.

Si viene `assignedTo`, la API ordena el pool de transferencia poniendo primero al vendedor asignado por GHL. Si ese vendedor no contesta, el failover continua con el resto del pool y finalmente con fallback.

---

### 3. Autenticación del panel admin

Para el MVP interno de demo puede seguir el mismo acceso operativo del Lab. Cuando se abra a más usuarios, se implementa autenticación simple por API key en los endpoints `/api/admin/*`:

- El panel envía el header `X-Admin-Key: <valor>`
- El valor se configura en una variable de entorno `ADMIN_API_KEY`
- El panel guarda la key en `localStorage` del navegador al iniciar sesión
- Sin usuarios, sin sesiones, sin JWT — suficiente para MVP

---

### 4. Admin separado de Lab

Lab se mantiene como herramienta de testing y monitoreo interno. Admin será una aplicación separada, con la misma base de datos y API, pero con una interfaz pensada para marketing y operaciones.

**Tecnología MVP:** crear `apps/admin/` como aplicación separada. Puede ser HTML/JS simple o React/Vite, pero debe quedar separada de Lab desde el principio.

**Recomendación:** React + Vite si el tiempo lo permite, porque Admin crecerá a clientes, roles, historial avanzado y filtros multi-campaña. Si hay presión de demo, HTML/JS separado también es aceptable.

**Pantallas:**

#### Pantalla 1: Lista de clientes
- Tabla con todos los clientes: nombre, número de campañas activas, fecha de creación
- Botón "Nuevo cliente"
- Click en un cliente abre su detalle

#### Pantalla 2: Detalle del cliente
- Información general del cliente (nombre, status)
- Lista de campañas con su status y métricas básicas (llamadas hoy, tasa de transferencia)
- Botón "Nueva campaña"

#### Pantalla 3: Detalle de campaña (sub-navegación)
Con cuatro tabs:

**Tab: Configuración VAPI**
- Formulario: Assistant ID, Phone Number ID, idioma y status
- Toggle activa/pausada. Si una campaña está pausada, Revenio ignora los webhooks de esa campaña.
- Campos GHL: Location ID, Pipeline ID, Stage ID y API key.
- La API key de GHL se puede pegar/actualizar, pero después solo se muestra como "API key configurada".
- Botón "Cargar desde VAPI" → llena los dropdowns con los asistentes y números disponibles
- Botón "Validar credenciales" → confirma que la config funciona antes de guardar
- Indicador de último guardado

**Tab: Agentes Humanos**
- Lista editable del pool de transferencia con nombre, `GHL User ID`, número y activo/inactivo
- Fallback final separado para gerente de marketing
- Agregar / editar / desactivar agentes
- Orden/prioridad simple de 1 a 5 para el MVP

**Tab: Historial de llamadas**
- Tabla de llamadas de esta campaña (equivalente al Histórico del Lab actual)
- Filtros por resultado, sentimiento, fecha
- Detalle con transcripción y grabación

**Tab: Ajustes**
- Nombre de la campaña, slug, status (activa / pausada / inactiva)

#### Pantalla 4: Test de llamada
- Reemplaza la necesidad de usar Lab para pruebas operativas
- Selector de campaña (dropdown)
- Al seleccionar una campaña, carga su configuración automáticamente
- Solo requiere ingresar: teléfono del lead y nombre
- Botón "Llamar" → lanza la llamada de prueba
- Panel de resultado en tiempo real

#### Pantalla 5: Historial global
- Vista agregada de todas las llamadas de todas las campañas
- Misma funcionalidad que el Histórico actual del Lab

---

## Fases de implementación ajustadas

### Fase 0 — Ya iniciado: Agentes GHL
- Crear tabla de vendedores humanos GHL.
- Crear setting de fallback final por campaña.
- Agregar vista temporal **Agentes GHL** en Lab.
- Webhook GHL lee vendedores/fallback desde BD antes de usar fallback de código.
- Webhook GHL ordena el pool con `assignedTo` primero cuando hay match contra `GHL User ID`.

### Fase 1 — Admin de campañas para demo
- Crear tabla de campañas GHL.
- Crear app separada `apps/admin/`.
- Agregar vista **Campañas** en Admin.
- Guardar `campaignId`, cliente, nombre, idioma, Assistant ID, Phone Number ID y status.
- Agregar toggle Activa/Pausada y hacer que el webhook respete campañas pausadas.
- Guardar GHL Location ID, Pipeline ID, Stage ID y API key secreta por campaña.
- Agregar vista **Agentes GHL** en Admin.
- Agregar fallback final en Admin.
- Generar entregable GHL por campaña.
- Webhook GHL resuelve campaña desde BD.
- En **Agentes GHL**, seleccionar campañas cargadas desde BD.
- Mantener agentes y fallback aislados por campaña: cambiar de campaña debe cargar su propio pool.

### Fase 2 — Test de llamada por campaña
- En Admin, agregar selector de campaña en prueba operativa.
- Al elegir campaña, el API usa Assistant ID y Phone Number ID desde BD.
- El operador solo captura teléfono/nombre del lead.
- Permitir prueba de routing con un `assignedTo` simulado para validar "asignado primero -> RR -> fallback".

### Fase 3 — Migración del cliente actual
- Crear el cliente "Caribbean Luxury Homes" en el nuevo sistema
- Crear campañas actuales: Isla Blanca ES/EN y Nikki Ocean ES/EN.
- Migrar Assistant IDs, Phone Number IDs, vendedores y fallback final.
- Verificar que las llamadas funcionen con el nuevo flujo
- Las variables de entorno quedan como respaldo

### Fase 4 — Admin completo multi-cliente
- Crear entidades `Client` formales.
- Mover métricas/historial a filtros por campaña/cliente.
- Añadir autenticación admin.
- Mantener Lab como herramienta técnica separada.

---

## Lo que no cambia

- El Dashboard de métricas (dashboard-v2) sigue igual
- Los webhooks de VAPI y Twilio no cambian
- El sistema de round-robin y failover no cambia en concepto: intenta vendedores y al final fallback. La mejora es que, si GHL manda `assignedTo`, ese vendedor se intenta primero.
- Toda la lógica de transcripción y grabaciones no cambia
- Los datos históricos no se tocan

---

## Criterios de éxito

| Criterio | Descripción |
|----------|-------------|
| Config persistente | Los agentes y credenciales de una campaña se guardan y cargan automáticamente |
| Multi-campaña | Se puede crear una segunda campaña sin tocar código ni variables de entorno |
| Panel funcional | El equipo de marketing puede crear y configurar una campaña sin asistencia técnica |
| Retrocompatibilidad | Las llamadas existentes de Casalba siguen funcionando sin cambios |
| Aislamiento | Las métricas y datos de cada campaña son independientes |
| Fallback final | Si ningún vendedor contesta, la llamada escala al gerente configurado en Admin |
| AssignedTo primero | Si GHL manda un vendedor asignado y coincide con Admin, Revenio lo intenta primero |
| Failover operativo | Si el asignado no contesta, Revenio continua con el resto del RR y finalmente fallback |

---

## Checklist para mañana

1. Confirmar campos mínimos de campaña:
   - nombre
   - `campaignId`
   - idioma
   - Vapi Assistant ID
   - Vapi Phone Number ID
   - status
2. Crear tabla/migración de campañas.
3. Crear `apps/admin/` separado de Lab.
4. Crear endpoints Admin para campañas.
5. Agregar pantalla **Campañas** en Admin.
6. Generar entregable GHL por campaña con Method, URL y tabla de Custom Data.
7. Mover/replicar **Agentes GHL** en Admin con vendedores + fallback.
8. Conectar webhook GHL para buscar campaña en BD.
9. Conectar **Agentes GHL** al selector de campañas de BD.
10. Validar routing por campaña: agentes guardados en campañas distintas no se mezclan.
11. Probar una llamada GHL con campaña creada desde Admin.
12. Probar caso `assignedTo`: vendedor asignado primero, resto del RR despues, fallback al final.
