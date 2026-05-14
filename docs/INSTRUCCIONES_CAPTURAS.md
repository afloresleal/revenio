# Instrucciones para Capturas de Pantalla
**Guía del Admin de Revenio**

---

## Preparación

Antes de tomar las capturas, necesitas:
1. Tener una campaña de prueba creada en el admin con datos de ejemplo
2. Configurar al menos 2-3 agentes con datos ficticios
3. Tener algunos registros de llamadas (si es posible)

**URL del admin**: https://revenio-admin.up.railway.app/

---

## Capturas Necesarias (11 total)

### 01-admin-overview.png
**Vista general del admin**
- Cómo tomar:
  1. Abre el admin con una campaña seleccionada
  2. Asegúrate de que se vea la barra lateral con la lista de campañas
  3. Asegúrate de que se vea el panel principal con la pestaña "Campaña"
  4. Toma captura de toda la ventana del navegador
- Qué debe mostrarse:
  - Barra lateral completa con logo "Revenio Admin"
  - Lista de campañas (al menos 1-2 campañas visibles)
  - Panel principal con las pestañas (Campaña, Agentes, GHL, Llamadas)
  - Formulario de campaña con algunos campos llenos

---

### 02-nueva-campana-button.png
**Botón para crear nueva campaña**
- Cómo tomar:
  1. Asegúrate de que el botón "Nueva" en la barra lateral sea visible
  2. Haz zoom si es necesario para que el botón se vea claro
  3. Toma captura de la barra lateral completa o solo la parte superior
- Qué debe mostrarse:
  - El encabezado "Campañas"
  - El botón azul "Nueva" claramente visible
  - Opcionalmente, la lista de campañas debajo

---

### 03-formulario-campana-lleno.png
**Formulario de campaña con datos de ejemplo**
- Cómo tomar:
  1. Llena TODOS los campos básicos de la campaña con datos ficticios:
     - Cliente: "Caribbean Luxury Homes"
     - Nombre de la campaña: "Isla Blanca ES"
     - Campaign ID: "isla-blanca-es"
     - GHL Location ID: "abc123def456"
     - Vapi Assistant ID: "12345678-1234-1234-1234-123456789012"
     - Vapi Phone Number ID: "87654321-4321-4321-4321-210987654321"
     - Idioma: "Español"
     - Campaña activa: Marcado ✓
  2. **NO expandas** la sección "Integración GHL post-llamada"
  3. Toma captura de todo el formulario
- Qué debe mostrarse:
  - Título "Nueva campaña" o "Editar campaña"
  - Todos los campos del formulario llenos con datos de ejemplo
  - La sección "Integración GHL post-llamada" colapsada (cerrada)
  - Botón "Guardar campaña" visible arriba

---

### 04-pestana-agentes.png
**Vista de la pestaña Agentes**
- Cómo tomar:
  1. Selecciona una campaña
  2. Haz clic en la pestaña "Agentes" (segunda pestaña)
  3. Toma captura mostrando las pestañas superiores y el inicio del formulario
- Qué debe mostrarse:
  - Las 4 pestañas: Campaña, **Agentes** (activa), GHL, Llamadas
  - El título "Agentes GHL"
  - El botón "Guardar agentes" arriba a la derecha
  - El inicio del formulario de agentes

---

### 05-agentes-configurados.png
**Agentes configurados con datos de ejemplo**
- Cómo tomar:
  1. En la pestaña "Agentes", llena al menos 2-3 agentes con datos ficticios:
     - **Agente 1**:
       - Nombre: "Ana"
       - GHL User ID: "user_123abc"
       - Teléfono: "+525512345678"
       - Activo: ✓
     - **Agente 2**:
       - Nombre: "Luis"
       - GHL User ID: "user_456def"
       - Teléfono: "+525587654321"
       - Activo: ✓
     - **Agente 3** (opcional):
       - Nombre: "Sofía"
       - GHL User ID: "user_789ghi"
       - Teléfono: "+525598765432"
       - Activo: ✓
  2. Llena el **Fallback final**:
     - Nombre: "Gerente de marketing"
     - Teléfono: "+525555555555"
     - GHL User ID: (dejar vacío o poner "user_fallback")
  3. Desplázate para mostrar todos los agentes y el fallback
  4. Toma captura de todo el formulario de agentes
- Qué debe mostrarse:
  - Los agentes llenos con datos de ejemplo
  - Los checkboxes "Activo" marcados
  - La sección "Fallback final" con sus campos llenos
  - Botón "Guardar agentes" visible

---

### 06-ghl-colapsada.png
**Sección de integración GHL colapsada**
- Cómo tomar:
  1. Ve a la pestaña "Campaña"
  2. Baja hasta ver la sección "Integración GHL post-llamada"
  3. Asegúrate de que esté **CERRADA** (colapsada)
  4. Toma captura mostrando el encabezado de la sección
- Qué debe mostrarse:
  - El título "Integración GHL post-llamada" con el triángulo apuntando a la derecha (►)
  - El texto descriptivo: "Solo se usa si Revenio actualizará la oportunidad..."
  - La sección cerrada (no se ven los campos dentro)

---

### 07-ghl-pipeline-config.png
**Configuración de Pipeline GHL expandida**
- Cómo tomar:
  1. Expande la sección "Integración GHL post-llamada" haciendo clic en el triángulo
  2. Llena SOLO los campos de "Configuración de Pipeline":
     - GHL API key: "sk_test_1234567890abcdef" (o poner "••••••••••••••••" para simular que está llena)
     - GHL Pipeline ID: "pipeline_abc123"
     - GHL New Lead Stage ID: "stage_new_lead_123"
     - GHL Connected Stage ID: "stage_contacted_456"
  3. **NO llenes** los campos de "Custom Fields" todavía
  4. Toma captura mostrando solo la sección "Configuración de Pipeline"
- Qué debe mostrarse:
  - El encabezado "Configuración de Pipeline"
  - Los 4 campos principales llenos con datos de ejemplo
  - El texto de ayuda bajo "GHL New Lead Stage ID" y "GHL Connected Stage ID"
  - El encabezado "Custom Fields" visible abajo pero SIN llenar

---

### 08-ghl-custom-fields.png
**Custom Fields GHL llenos**
- Cómo tomar:
  1. En la misma sección expandida de GHL, baja hasta "Custom Fields"
  2. Llena los 3 campos con datos de ejemplo:
     - Outcome Field ID: "field_outcome_789"
     - Seller Talk Field ID: "field_seller_talk_012"
     - Recording URL Field ID: "field_recording_345"
  3. Toma captura mostrando solo la sección "Custom Fields"
- Qué debe mostrarse:
  - El encabezado "Custom Fields"
  - Los 3 campos llenos con IDs de ejemplo
  - Los textos de ayuda bajo cada campo

---

### 09-llamadas-vacia.png
**Pestaña Llamadas sin datos**
- Cómo tomar:
  1. Crea una campaña nueva (sin llamadas todavía)
  2. Selecciona esa campaña nueva
  3. Haz clic en la pestaña "Llamadas" (cuarta pestaña)
  4. Toma captura mostrando la vista vacía
- Qué debe mostrarse:
  - Las pestañas superiores con "Llamadas" activa
  - El título "Llamadas de la campaña"
  - Los botones "Actualizar" y "Descargar CSV"
  - El mensaje "Selecciona una campaña para ver sus llamadas" o tabla vacía

---

### 10-llamadas-con-datos.png
**Tabla de llamadas con registros**
- Cómo tomar:
  1. Selecciona una campaña que tenga llamadas registradas
  2. Si no tienes llamadas reales, usa datos de prueba o simula algunos registros
  3. Haz clic en "Actualizar" para cargar los datos
  4. Toma captura mostrando la tabla completa con varios registros
- Qué debe mostrarse:
  - La tabla con al menos 3-5 registros de llamadas
  - Diferentes valores en la columna "Outcome": transfer_success, voicemail, abandoned
  - Diferentes valores en la columna "Sentiment": positive, neutral, negative
  - Todas las columnas visibles: Teléfono, Outcome, Sentiment, Assigned To, Duration, Seller Talk, Started At

---

### 11-pestana-ghl-instrucciones.png
**Pestaña GHL con instrucciones del webhook**
- Cómo tomar:
  1. Selecciona una campaña con datos completos (Campaign ID, Location ID, etc.)
  2. Haz clic en la pestaña "GHL" (tercera pestaña)
  3. Toma captura mostrando las tablas de instrucciones
- Qué debe mostrarse:
  - El título "Entregable para GHL"
  - El botón "Copiar instrucciones"
  - La tabla "Webhook" con la URL y el método POST
  - La tabla "Custom Data" con todos los campos (type, campaignId, locationId, etc.)
  - La lista de "Validaciones"

---

## Guardar las Capturas

1. Crea una carpeta llamada `screenshots` dentro de `/Users/ale/Documents/Code/revenio/docs/`
2. Guarda cada captura con el nombre exacto indicado arriba (por ejemplo: `01-admin-overview.png`)
3. Asegúrate de que todas las capturas estén en formato PNG
4. Verifica que todas las capturas sean legibles y no estén borrosas

---

## Convertir a PDF

Una vez que tengas todas las capturas guardadas en la carpeta `screenshots/`, puedes convertir la guía a PDF usando cualquiera de estos métodos:

### Método 1: Usar Markdown PDF (extensión de VSCode)
1. Instala la extensión "Markdown PDF" en VSCode
2. Abre `GUIA_ADMIN_MARKETING.md`
3. Presiona `Cmd+Shift+P` → "Markdown PDF: Export (pdf)"

### Método 2: Usar pandoc (terminal)
```bash
cd /Users/ale/Documents/Code/revenio/docs
pandoc GUIA_ADMIN_MARKETING.md -o GUIA_ADMIN_MARKETING.pdf \
  --pdf-engine=wkhtmltopdf \
  -V geometry:margin=1in \
  --metadata title="Guía del Admin de Revenio"
```

### Método 3: Online
1. Ve a https://www.markdowntopdf.com/
2. Copia todo el contenido de `GUIA_ADMIN_MARKETING.md`
3. Pega en el sitio web
4. Descarga el PDF

---

## Checklist Final

Antes de generar el PDF, verifica:
- [ ] Las 11 capturas están guardadas en `docs/screenshots/`
- [ ] Todos los nombres de archivo son correctos (01-admin-overview.png, 02-nueva-campana-button.png, etc.)
- [ ] Todas las capturas son legibles y muestran la información correcta
- [ ] El documento Markdown se ve bien en la preview de VSCode
- [ ] Las imágenes se cargan correctamente en la preview

---

**¿Necesitas ayuda?**
Si alguna captura no se ve bien o tienes dudas sobre qué mostrar, puedes:
1. Revisar esta lista de nuevo
2. Comparar con la descripción en la guía principal
3. Preguntar al equipo técnico
