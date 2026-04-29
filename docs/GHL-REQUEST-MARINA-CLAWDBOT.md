# Solicitud Para Marina / Clawdbot - GoHighLevel Test

Necesitamos completar la configuracion de la cuenta de pruebas de GoHighLevel para probar la integracion con Revenio en staging.

## Contexto

API staging de Revenio:

```text
https://revenioapi-staging.up.railway.app
```

Webhook que debe recibir eventos desde GHL:

```text
https://revenioapi-staging.up.railway.app/webhooks/gohighlevel
```

Cuenta/location de pruebas:

```text
Location ID: dOlMhCyzBPIxKGO4CTDq
Pipeline: Marketing Pipeline
Pipeline ID: y1d5iqHAz5WE5hdjpyia
```

Evento requerido:

```text
OpportunityAssignedTo / OpportunityAssignedToUpdate
```

## Lo Que Necesitamos

### 1. Agente De Prueba

Necesitamos al menos un usuario/agente de prueba para que Revenio pueda transferir la llamada.

Favor entregar:

```text
GHL_TEST_AGENT_1_NAME=
GHL_TEST_AGENT_1_GHL_USER_ID=
GHL_TEST_AGENT_1_PHONE=
```

Notas:

- `GHL_TEST_AGENT_1_GHL_USER_ID` debe ser el mismo valor que aparece en `assignedTo` cuando GHL asigna la oportunidad.
- `GHL_TEST_AGENT_1_PHONE` debe venir en formato internacional, idealmente `+52...`.

Si hay mas agentes de prueba, enviar tambien:

```text
GHL_TEST_AGENT_2_NAME=
GHL_TEST_AGENT_2_GHL_USER_ID=
GHL_TEST_AGENT_2_PHONE=
```

Maximo actual: 5 agentes.

### 2. Stage Inicial Para Disparar Revenio

Necesitamos el stage donde entran los leads nuevos y desde donde debe dispararse Revenio.

Favor entregar:

```text
GHL_TEST_TRIGGER_STAGE_ID=
```

Nombre esperado:

```text
New Lead
```

Nota: necesitamos el **stage ID**, no solo el nombre.

### 3. Stage Destino Cuando Revenio Conecta

Cuando Revenio logra conectar la llamada con un agente humano, debe mover la oportunidad a un stage destino.

Favor crear o confirmar este stage:

```text
Contacto vendedor - Llamada
```

Favor entregar:

```text
GHL_TEST_CONNECTED_STAGE_ID=
```

Nota: necesitamos el **stage ID**, no solo el nombre.

### 4. Custom Field Para Transcript

Cuando Revenio termine la llamada, debe escribir el transcript en un campo custom de la oportunidad.

Favor crear o confirmar un custom field en Opportunity:

```text
Nombre: Llamada de contacto inicial
Tipo: texto largo / multiline
Objeto: Opportunity
```

Favor entregar:

```text
GHL_TEST_TRANSCRIPT_FIELD_ID=
```

Nota: necesitamos el **custom field ID**, no solo el nombre.

### 5. Payload Real Del Webhook

Favor generar o capturar un ejemplo real del webhook que GHL enviara cuando se asigne una oportunidad.

Esperamos algo parecido a:

```json
{
  "type": "OpportunityAssignedTo",
  "locationId": "dOlMhCyzBPIxKGO4CTDq",
  "id": "<opportunity_id>",
  "assignedTo": "<ghl_user_id>",
  "contact": {
    "id": "<contact_id>",
    "firstName": "Juan",
    "lastName": "Perez",
    "phone": "+525512345678",
    "email": "juan@example.com",
    "assignedTo": "<ghl_user_id>"
  },
  "pipeline": {
    "id": "y1d5iqHAz5WE5hdjpyia",
    "name": "Marketing Pipeline"
  },
  "stage": {
    "id": "<stage_id>",
    "name": "New Lead"
  }
}
```

## Formato De Respuesta Deseado

Por favor devolver los datos asi:

```bash
GHL_TEST_AGENT_1_NAME=
GHL_TEST_AGENT_1_GHL_USER_ID=
GHL_TEST_AGENT_1_PHONE=

GHL_TEST_TRIGGER_STAGE_ID=
GHL_TEST_CONNECTED_STAGE_ID=
GHL_TEST_TRANSCRIPT_FIELD_ID=
```

Y adjuntar el JSON real del webhook si es posible.

## Prueba Que Haremos Con Esto

1. GHL asigna una oportunidad en `New Lead`.
2. GHL envia webhook a Revenio staging.
3. Revenio llama al lead.
4. Revenio transfiere al agente de prueba.
5. Si el agente contesta, Revenio actualiza GHL:
   - asigna la oportunidad al agente que contesto,
   - mueve la oportunidad a `Contacto vendedor - Llamada`,
   - escribe el transcript en `Llamada de contacto inicial`.

Si nadie contesta, Revenio no actualiza GHL.
