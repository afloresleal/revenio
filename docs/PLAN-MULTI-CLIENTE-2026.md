# Plan de Crecimiento: Arquitectura Multi-Cliente
## Revenio — Mayo 2026

> **Estado actual:** Admin operativo en `apps/admin` para crear campañas GHL, configurar vendedores humanos, fallback final y generar el entregable de webhook para marketing.
> **Objetivo:** terminar la transición multi-cliente/multi-campaña sin que el equipo tenga que tocar Railway ni código para operar demos.
> **Prioridad inmediata:** validar el demo GHL en staging con campañas creadas desde Admin y mantener Lab como herramienta técnica interna.

Guía operativa vigente: [ADMIN-GHL-CAMPAIGNS.md](./ADMIN-GHL-CAMPAIGNS.md)

---

## Contexto: Cómo funciona hoy

Revenio es un sistema de llamadas outbound con IA. El flujo actual:

1. El sistema llama a un lead (prospecto)
2. Un agente de voz (VAPI) lo saluda y transfiere en <30 segundos
3. La llamada llega a un agente humano de ventas
4. Se registran métricas: duración, resultado, sentimiento, transcripción

**Decisión actual:** la configuración operativa de campañas GHL ya no debe vivir en variables de entorno ni en código. Marina y su equipo deben crear campañas, seleccionar asistentes de Vapi, cargar vendedores humanos y configurar fallback desde Admin.

**Avance actual:** Admin ya existe separado de Lab. Lab queda para monitoreo técnico, pruebas manuales y debugging; Admin queda como interfaz operativa para marketing.

---

## Decisión operativa para demos GHL

Para demos con clientes, Revenio debe tener una sola fuente de verdad operativa:

- **Vapi:** solo conserva assistants, voces, prompts y Server URL.
- **GHL:** manda `campaignId`, lead y, cuando ya exista, `assignedTo`.
- **Revenio Admin/BD:** guarda campañas, IDs de Vapi, vendedores humanos y fallback final.
- **Revenio Lab:** queda para monitoreo, soporte interno, pruebas manuales y debugging.
- **Railway:** solo conserva secretos y configuración de infraestructura, no operación diaria de campañas ni datos de vendedores.

Esto evita que el equipo tenga que entrar a Railway para cambiar números o agregar campañas, y evita que el equipo de marketing vea JSONs o herramientas técnicas.

### Estado después del Admin

- Las campañas se crean en Admin y se guardan en BD.
- Cada campaña guarda `campaignId`, cliente, nombre, idioma, `GHL Location ID`, `Vapi Assistant ID`, `Vapi Phone Number ID`, status activa/pausada y, si aplica, configuración avanzada de GHL.
- Los vendedores humanos y el fallback final se guardan por campaña en BD.
- El webhook de GHL debe enviar `campaignId`; Revenio usa ese valor para resolver la campaña desde BD.
- Si la campaña está pausada, Revenio ignora el webhook sin lanzar llamada.
- Si GHL manda `assignedTo` y coincide con un `GHL User ID`, ese vendedor se intenta primero.
- Si `assignedTo` viene vacío o no coincide, Revenio empieza con el primer vendedor activo del pool de la campaña.
- Si no hay vendedores activos, Revenio usa el fallback final si está configurado.
- No debe haber datos de clientes, campañas, vendedores ni teléfonos hardcodeados en `apps/api/src/routes/webhooks.ts`.
- Admin apunta a staging para demos mientras terminamos pruebas: `https://revenioapi-staging.up.railway.app`.

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

## MVP actual antes del demo

Antes de hacer el modelo completo de clientes, el MVP operativo en Admin queda así:

1. **Campañas en BD**
   - Crear/editar campañas desde Admin. Implementado para el demo.
   - Guardar `campaignId`, nombre, cliente, Vapi Assistant ID, Vapi Phone Number ID, idioma y status. Implementado.
   - Activar/pausar campaña sin borrarla. Implementado; si está pausada, el webhook no debe disparar llamadas.
   - Guardar configuración GHL por campaña: Location ID como dato principal; Pipeline ID, Stage ID, API key y transcript custom field como datos avanzados cuando aplique el push post-llamada a GHL.
   - El webhook GHL busca campañas en BD. No debe usar variables/código para datos de campañas nuevas.

2. **Agentes GHL en BD**
   - Implementado en Admin.
   - Cada campaña tiene hasta 5 vendedores humanos.
   - Cada vendedor tiene nombre, `GHL User ID`, teléfono, prioridad y activo/inactivo.
   - Cada pool tiene fallback final, normalmente gerente de marketing, con `GHL User ID` opcional.
   - Si GHL manda `assignedTo`, el vendedor con ese `GHL User ID` se intenta primero; despues siguen los demas vendedores activos.
   - Si GHL no manda `assignedTo` o no coincide, Revenio empieza por el pool de vendedores de esa campaña y termina en fallback final.

3. **Historial y exportación**
   - Admin muestra datos de llamadas por campaña.
   - La exportación CSV queda como formato operativo inicial.
   - La pestaña de prueba queda oculta por ahora; las pruebas se lanzan desde GHL.

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

### 2. API — Endpoints actuales

Para el MVP de Admin se recomienda usar endpoints propios de admin. Lab puede seguir usando sus endpoints técnicos actuales.

**Campañas:**
```
GET    /api/admin/ghl-campaigns                  → Listar campañas
POST   /api/admin/ghl-campaigns                  → Crear campaña
PUT    /api/admin/ghl-campaigns/:id              → Editar campaña
GET    /api/admin/ghl-campaigns/:id              → Detalle de campaña
GET    /api/admin/ghl-campaigns/:id/calls.csv    → Descargar llamadas de la campaña en CSV
```

**Agentes humanos de una campaña:**
```
GET    /api/admin/ghl-agents                     → Listar agentes + fallback por campaña
PUT    /api/admin/ghl-agents                     → Guardar pool completo + fallback final
```

**Prueba operativa por campaña:**
```
POST   /api/admin/ghl-campaigns/:id/test-call    → Existe, pero la pestaña está oculta en Admin mientras las pruebas salen desde GHL
```

**Pendiente para la fase multi-cliente formal:**
```
GET    /api/admin/clients
POST   /api/admin/clients
GET    /api/admin/clients/:clientSlug
PUT    /api/admin/clients/:clientSlug
```

**Webhook de GHL:**

El webhook de GHL debe aceptar `campaignId` y resolver la campaña desde BD:

```json
{
  "campaignId": "isla-blanca-es",
  "assignedTo": "ghl-user-id-del-vendedor",
  "lead": { "phone": "+52...", "name": "Juan" }
}
```

`campaignId` es obligatorio para demos nuevos. Si no existe en BD, Revenio no debe inferir cliente/campaña desde código.

Si viene `assignedTo`, la API ordena el pool de transferencia poniendo primero al vendedor asignado por GHL. Si ese vendedor no contesta, el failover continua con el resto del pool y finalmente con fallback.

---

### 3. Autenticación del panel admin

Para el MVP interno de demo, Admin sigue el mismo acceso operativo del Lab: no hay login propio ni `ADMIN_API_KEY`.

Cuando se abra a más usuarios, se implementará autenticación simple por API key en los endpoints `/api/admin/*`:

- El panel envía el header `X-Admin-Key: <valor>`
- El valor se configura en una variable de entorno `ADMIN_API_KEY`
- El panel guarda la key en `localStorage` del navegador al iniciar sesión
- Sin usuarios, sin sesiones, sin JWT — suficiente para MVP

---

### 4. Admin separado de Lab

Lab se mantiene como herramienta de testing y monitoreo interno. Admin será una aplicación separada, con la misma base de datos y API, pero con una interfaz pensada para marketing y operaciones.

**Tecnología MVP actual:** `apps/admin/` es una aplicación separada en HTML/JS simple, con el mismo look and feel oscuro de Lab/Dashboard.

**Evolución futura:** si Admin crece a roles, permisos, filtros complejos y múltiples clientes formales, conviene migrarlo a React/Vite. Para el demo, mantenerlo simple reduce riesgo.

**Pantallas:**

#### Pantalla actual: Campañas
- Crear/editar campaña.
- Capturar cliente, nombre, `campaignId`, `GHL Location ID`, IDs de Vapi, idioma y status.
- Capturar configuración avanzada de GHL cuando aplique el push post-llamada.
- Generar entregable de webhook para GHL.

#### Pantalla actual: Agentes Humanos
- Lista editable del pool de transferencia con nombre, `GHL User ID`, número y activo/inactivo
- Fallback final separado para gerente de marketing
- Agregar / editar / desactivar agentes
- Orden/prioridad simple de 1 a 5 para el MVP

#### Pantalla actual: Historial de llamadas
- Tabla de llamadas de la campaña.
- Datos operativos principales: vendedor seleccionado, teléfono, duración, tiempos y resultado.
- Exportación CSV.

#### Pantalla oculta: Prueba
- Existe soporte de API para test-call por campaña.
- La pestaña queda oculta mientras las pruebas se ejecutan desde GHL.

#### Futuro: Clientes
- Tabla formal de clientes.
- Detalle de cliente con campañas, status y métricas agregadas.
- Filtros por cliente/campaña en historial global.

---

## Fases de implementación ajustadas

### Fase 0 — Completada: Agentes GHL
- Crear tabla de vendedores humanos GHL.
- Crear setting de fallback final por campaña.
- Agregar fallback final con `GHL User ID` opcional.
- Webhook GHL lee vendedores/fallback desde BD.
- Webhook GHL ordena el pool con `assignedTo` primero cuando hay match contra `GHL User ID`.
- Si no hay `assignedTo` o no hay match, el webhook usa el pool de la campaña y luego fallback final.

### Fase 1 — Completada para demo: Admin de campañas
- Crear tabla de campañas GHL.
- Crear app separada `apps/admin/`.
- Agregar vista **Campañas** en Admin.
- Guardar `campaignId`, cliente, nombre, idioma, Assistant ID, Phone Number ID y status.
- Agregar toggle Activa/Pausada y hacer que el webhook respete campañas pausadas.
- Guardar GHL Location ID, Pipeline ID, Stage ID, transcript field y API key secreta por campaña.
- Agregar vista **Agentes GHL** en Admin.
- Agregar fallback final en Admin.
- Generar entregable GHL por campaña.
- Webhook GHL resuelve campaña desde BD.
- Mantener agentes y fallback aislados por campaña: cambiar de campaña carga su propio pool.
- Admin apunta a staging por default fuera de local mientras validamos demo.

### Fase 2 — Parcial: Historial por campaña y CSV
- Admin muestra historial por campaña.
- Admin descarga CSV por campaña.
- La prueba de llamada por campaña existe en API, pero queda oculta en Admin porque por ahora las pruebas salen desde GHL.
- Cuando haya un cliente sin CRM, se puede volver a mostrar la pestaña de prueba.

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

## Checklist para el demo en staging

1. Crear campaña desde Admin.
2. Confirmar que la campaña queda activa.
3. Capturar `GHL Location ID`.
4. Capturar `Vapi Assistant ID` y `Vapi Phone Number ID`.
5. Capturar vendedores humanos con teléfono E.164 y `GHL User ID` cuando exista.
6. Capturar fallback final con teléfono E.164 y `GHL User ID` opcional.
7. Copiar el entregable de GHL desde Admin.
8. Configurar el webhook en GHL con URL staging y Custom Data campo por campo.
9. Probar una llamada GHL con campaña creada desde Admin.
10. Probar caso con `assignedTo`: vendedor asignado primero, resto del RR despues, fallback al final.
11. Probar caso sin `assignedTo`: primer vendedor activo del pool, resto del RR despues, fallback al final.
12. Descargar CSV de la campaña y validar que aparezcan llamada, vendedor seleccionado, duración y transcripción cuando esté disponible.
