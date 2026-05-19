# Guía del Admin de Revenio
**Para equipos de Marketing**

---

## Índice

1. [Acceso al Admin](#acceso-al-admin)
2. [Crear una nueva campaña](#crear-una-nueva-campaña)
3. [Configurar agentes de ventas](#configurar-agentes-de-ventas)
4. [Configuración de GHL (GoHighLevel)](#configuración-de-ghl-gohighlevel)
5. [Ver historial de llamadas](#ver-historial-de-llamadas)
6. [Preguntas frecuentes](#preguntas-frecuentes)

---

## Acceso al Admin

**URL de producción**: `https://<ADMIN_HOST>/`

El admin es donde configuras todas las campañas de llamadas de Revenio. Desde aquí puedes:
- Crear y editar campañas
- Configurar qué vendedores recibirán las llamadas
- Conectar con GoHighLevel (GHL)
- Ver el historial de llamadas de cada campaña

![Vista general del admin](screenshots/01-admin-overview.png)
*Captura: Vista general del admin con la lista de campañas en la barra lateral y el panel principal*

---

## Crear una nueva campaña

### Paso 1: Abrir el formulario de campaña nueva

1. En la barra lateral izquierda, haz clic en el botón **"Nueva"**
2. Se abrirá el formulario de campaña en blanco


![Botón Nueva Campaña](screenshots/02-nueva-campana-button.png)

*Captura: Botón "Nueva" en la barra lateral para crear una campaña*

### Paso 2: Datos básicos de la campaña

Llena los siguientes campos:

#### **Cliente**
- Nombre del cliente (ejemplo: "<CLIENTE_DEMO>")
- Este es solo para tu referencia interna

#### **Nombre de la campaña**
- Nombre descriptivo de la campaña (ejemplo: "<PROPIEDAD_DEMO_A> ES")
- También es solo para tu referencia

#### **Campaign ID**
- Un identificador único (ejemplo: "propiedad-demo-a-es")
- Debe ser corto, sin espacios, solo letras minúsculas y guiones
- **Importante**: Este ID se usará en GoHighLevel para conectar el workflow

#### **GHL Location ID**
- El ID de la ubicación en GoHighLevel
- Lo encuentras en GHL → Settings → Company → Location ID

#### **Vapi Assistant ID**
- El ID del asistente de voz configurado en Vapi
- Te lo proporcionará el equipo técnico

#### **Vapi Phone Number ID**
- El ID del número de teléfono en Vapi
- Te lo proporcionará el equipo técnico

#### **Idioma**
- Selecciona "Español" o "Inglés" según la campaña

#### **Campaña activa**
- Deja el checkbox marcado para que la campaña esté activa
- Si lo desmarcas, la campaña no recibirá llamadas

![Formulario de campaña completo](screenshots/03-formulario-campana-lleno.png)
*Captura: Formulario de campaña con todos los campos básicos llenos (ejemplo con datos ficticios)*

### Paso 3: Guardar la campaña

1. Haz clic en el botón **"Guardar campaña"** (arriba a la derecha)
2. Verás un mensaje de confirmación
3. La campaña aparecerá en la lista de la barra lateral

---

## Configurar agentes de ventas

Los agentes son los vendedores que recibirán las llamadas transferidas del asistente de voz.

### Paso 1: Ir a la pestaña "Agentes"

1. Selecciona tu campaña en la barra lateral
2. Haz clic en la pestaña **"Agentes"** (segunda pestaña del panel)

![Pestaña Agentes](screenshots/04-pestana-agentes.png)
*Captura: Vista de la pestaña "Agentes" con las pestañas superiores visibles*

### Paso 2: Configurar hasta 5 agentes

Para cada agente, llena:

#### **Nombre**
- Nombre del vendedor (ejemplo: "Ana")

#### **GHL User ID**
- El ID del usuario en GoHighLevel
- Lo encuentras en GHL → Settings → Team → [Usuario] → User ID
- **Importante**: Este ID debe coincidir exactamente con el valor "assignedTo" que envía GHL

#### **Teléfono**
- Número de teléfono del vendedor en formato E.164
- Ejemplo: `<PHONE_E164>`
- **Debe incluir** el código de país (+52 para México)

#### **Activo**
- Deja el checkbox marcado para que el vendedor reciba llamadas
- Si lo desmarcas, ese vendedor será saltado en la rotación

### Paso 3: Configurar fallback final

El **fallback final** es un número de respaldo que se usa solo si ningún vendedor del pool contesta.

Típicamente aquí va:
- El número del gerente de marketing
- Un número de oficina general
- Un buzón de voz corporativo

Llena:
- **Nombre**: "Gerente de marketing"
- **GHL User ID**: (opcional, puedes dejarlo vacío)
- **Teléfono**: Número en formato E.164

![Agentes configurados](screenshots/05-agentes-configurados.png)
*Captura: Lista de agentes con datos de ejemplo y fallback final configurado*

### Paso 4: Guardar

1. Haz clic en **"Guardar agentes"**
2. Verás un mensaje de confirmación

---

## Configuración de GHL (GoHighLevel)

Esta sección es **opcional**. Solo configúrala si quieres que Revenio actualice automáticamente las oportunidades en GHL después de cada llamada.

### ¿Cuándo usar esta integración?

Úsala si quieres que Revenio:
- Mueva el lead a un stage diferente después de contactarlo
- Guarde el resultado de la llamada en custom fields
- Guarde el enlace de la grabación en GHL
- Registre cuánto tiempo habló el vendedor con el cliente

### Paso 1: Expandir sección de integración GHL

1. En la pestaña **"Campaña"**, baja hasta "Integración GHL post-llamada"
2. Haz clic en el triángulo para expandir la sección

![Sección GHL colapsada](screenshots/06-ghl-colapsada.png)
*Captura: Sección "Integración GHL post-llamada" colapsada (antes de expandir)*

### Paso 2: Configuración de Pipeline

#### **GHL API key**
- Pega tu API key de GoHighLevel
- La encuentras en GHL → Settings → API → Create Key
- **Permisos necesarios**: contacts.write, opportunities.write
- La key se guarda encriptada

#### **GHL Pipeline ID**
- El ID del pipeline donde viven los leads
- Lo encuentras en GHL → Pipelines → [Tu Pipeline] → Settings
- Copia el ID que aparece en la URL

#### **GHL New Lead Stage ID**
- El ID del stage donde viven los leads **antes** de que Revenio los contacte
- Típicamente es el stage "New Lead" o "Cold Lead"
- Lo encuentras en GHL → Pipelines → [Tu Pipeline] → [Stage] → Copy Stage ID

#### **GHL Connected Stage ID**
- El ID del stage donde mover el lead **después** de contactarlo
- Típicamente es el stage "Contacted" o "Warm"
- Este mismo stage se usa tanto si:
  - ✅ El vendedor contesta (transfer_success)
  - ✅ Va a buzón del cliente (voicemail)
- Ambos casos significan "intentamos contactar al cliente"

![Configuración de Pipeline GHL](screenshots/07-ghl-pipeline-config.png)
*Captura: Sección "Configuración de Pipeline" expandida con los 4 campos principales llenos*

### Paso 3: Custom Fields (opcional)

Si quieres guardar más información en GHL, configura estos campos:

#### **Outcome Field ID**
- ID del custom field donde guardar el resultado de la llamada
- Ejemplo de valores: "transfer_success", "voicemail", "abandoned"

#### **Seller Talk Field ID**
- ID del custom field donde guardar cuántos segundos habló el vendedor
- Tipo de campo: Number

#### **Recording URL Field ID**
- ID del custom field donde guardar el enlace de la grabación
- Tipo de campo: Text (URL)

**¿Cómo obtener los IDs de custom fields?**
1. GHL → Settings → Custom Fields
2. Crea los campos si no existen
3. Haz clic en el campo → Copy Field ID

![Custom Fields GHL](screenshots/08-ghl-custom-fields.png)
*Captura: Sección "Custom Fields" con los 3 campos opcionales llenos*

### Paso 4: Guardar

1. Haz clic en **"Guardar campaña"**
2. La integración con GHL estará activa

---

## Ver historial de llamadas

### Paso 1: Ir a la pestaña "Llamadas"

1. Selecciona tu campaña en la barra lateral
2. Haz clic en la pestaña **"Llamadas"** (cuarta pestaña)

![Pestaña Llamadas vacía](screenshots/09-llamadas-vacia.png)
*Captura: Vista de la pestaña "Llamadas" sin datos (campaña nueva)*

### Paso 2: Ver los registros

Aquí verás una tabla con todas las llamadas de la campaña:

**Columnas principales**:
- **Teléfono**: Número del lead contactado
- **Outcome**: Resultado de la llamada
  - `transfer_success` = Vendedor contestó
  - `voicemail` = Fue a buzón del cliente
  - `abandoned` = Cliente colgó
  - `completed` = Llamada completada sin transferencia
- **Sentiment**: Análisis del tono
  - `positive` = Conversación positiva
  - `neutral` = Conversación neutra
  - `negative` = Conversación negativa
- **Assigned To**: GHL User ID del vendedor asignado
- **Duration**: Duración total de la llamada (segundos)
- **Seller Talk**: Tiempo que el vendedor habló con el cliente (segundos)
- **Started At**: Fecha y hora de la llamada

![Tabla de llamadas con datos](screenshots/10-llamadas-con-datos.png)
*Captura: Tabla de llamadas con varios registros mostrando diferentes outcomes y sentiments*

### Paso 3: Filtrar y descargar

#### **Actualizar la tabla**
- Haz clic en el botón **"Actualizar"** para ver las llamadas más recientes

#### **Descargar CSV**
- Haz clic en **"Descargar CSV"** para exportar todas las llamadas
- El archivo se descarga con nombre `revenio-[campaign-id]-calls.csv`
- Puedes abrirlo en Excel o Google Sheets

---

## Preguntas frecuentes

### ¿Cómo sé si mi campaña está funcionando?

1. Ve a la pestaña **"Llamadas"**
2. Haz clic en **"Actualizar"**
3. Deberías ver registros de llamadas recientes
4. Si no ves nada, verifica:
   - ✅ La campaña está marcada como "activa"
   - ✅ El Campaign ID en el admin coincide con el del workflow de GHL
   - ✅ El workflow de GHL está publicado y activo

### ¿Qué pasa si un vendedor no contesta?

El sistema hace lo siguiente:
1. Intenta transferir al primer vendedor activo (por orden de prioridad)
2. Si no contesta en ~20 segundos, intenta con el siguiente vendedor
3. Repite hasta probar todos los vendedores activos
4. Si ninguno contesta, transfiere al número de **fallback final**

### ¿Cómo desactivo un vendedor temporalmente?

1. Ve a la pestaña **"Agentes"**
2. Desmarca el checkbox **"Activo"** del vendedor
3. Haz clic en **"Guardar agentes"**
4. Ese vendedor ya no recibirá llamadas

### ¿Puedo tener múltiples campañas para el mismo cliente?

Sí, puedes crear todas las campañas que necesites. Por ejemplo:
- `propiedad-demo-a-es` (campaña en español)
- `propiedad-demo-a-en` (campaña en inglés)
- `propiedad-demo-b-es` (otro proyecto)

Cada campaña tiene:
- Su propio pool de vendedores
- Su propia configuración de GHL
- Su propio historial de llamadas

### ¿Qué es el "Campaign ID" y por qué es importante?

El **Campaign ID** es el identificador único que conecta:
- El workflow de GHL
- La configuración del admin de Revenio
- Los registros de llamadas

**Importante**: El Campaign ID que pongas en el admin **DEBE coincidir exactamente** con el valor que envías en el webhook de GHL (campo `campaignId` en Custom Data).

### ¿Cómo configuro el webhook en GHL?

![Pestaña GHL con instrucciones](screenshots/11-pestana-ghl-instrucciones.png)
*Captura: Pestaña "GHL" mostrando las instrucciones del webhook listas para copiar*

Para conectar GHL con Revenio:

1. En GHL, crea un workflow que se dispare cuando:
   - Una oportunidad se asigne a un vendedor
   - La oportunidad esté en el stage correcto (ejemplo: "New Lead")

2. Agrega una acción **Webhook**

3. Configura el webhook con estos datos:
   - **URL**: `https://<API_PRODUCTION_HOST>/webhooks/gohighlevel`
   - **Method**: POST
   - **Custom Data**:
     ```
     type: OpportunityAssignedTo
     campaignId: [tu-campaign-id]
     locationId: {{opportunity.location_id}}
     id: {{opportunity.id}}
     assignedTo: {{opportunity.assigned_to}}
     contactId: {{contact.id}}
     firstName: {{contact.first_name}}
     lastName: {{contact.last_name}}
     phone: {{contact.phone}}
     email: {{contact.email}}
     pipelineId: {{opportunity.pipeline_id}}
     pipelineName: {{opportunity.pipeline_name}}
     stageId: {{opportunity.pipeline_stage_id}}
     stageName: {{opportunity.pipeline_stage_name}}
     ```

4. Guarda y publica el workflow

**Nota**: La pestaña **"GHL"** en el admin te muestra exactamente esta configuración lista para copiar.

### ¿Qué significa cada outcome?

- **transfer_success**: El vendedor contestó la transferencia y habló con el cliente
- **voicemail**: La llamada fue a buzón del cliente (nadie contestó)
- **abandoned**: El cliente colgó durante la conversación con el asistente de voz
- **completed**: La llamada terminó normalmente sin llegar a transferencia

### ¿Qué significa cada sentiment?

- **positive**: La conversación fue amigable y receptiva
- **neutral**: Conversación normal, sin indicadores positivos o negativos fuertes
- **negative**: Cliente mostró frustración, colgó rápido, o fue hostil

### ¿Puedo editar una campaña después de crearla?

Sí, puedes editar cualquier campo en cualquier momento:
1. Selecciona la campaña en la barra lateral
2. Edita los campos que necesites
3. Haz clic en **"Guardar campaña"**

**Nota**: Los cambios NO afectan las llamadas que ya se hicieron, solo las nuevas.

### ¿Qué hago si veo un error al guardar?

Los errores más comunes son:

**"Error de conexión"**
- Verifica tu conexión a internet
- Recarga la página y vuelve a intentar

**"campaign_id_exists"**
- Ya existe una campaña con ese Campaign ID
- Usa un ID diferente

**"invalid_payload"**
- Falta un campo requerido
- Verifica que todos los campos obligatorios estén llenos

Si el error persiste, contacta al equipo técnico.

---

## Soporte técnico

Si tienes problemas o dudas que no se resuelven con esta guía:

1. Revisa la pestaña **"Llamadas"** para ver si hay registros
2. Verifica que tu workflow de GHL esté publicado y activo
3. Contacta al equipo técnico con:
   - El nombre de la campaña
   - El Campaign ID
   - Descripción del problema
   - Screenshots si es posible

---

