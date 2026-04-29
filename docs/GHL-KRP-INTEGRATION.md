# Integracion GoHighLevel - KRP Estate Group

Estado: MVP tecnico para conectar GHL con el flujo actual de Revenio.

## Entrada desde GHL

Endpoint:

```text
POST /webhooks/gohighlevel
```

Eventos soportados:

```text
OpportunityAssignedTo
OpportunityAssignedToUpdate
```

El endpoint espera `locationId`, `id` de oportunidad, `assignedTo` y datos de contacto. Si el payload no trae `contact.phone`, intenta consultar `GET /contacts/:contactId` usando la API key de la propiedad.

## Propiedades configuradas

```text
GoHighLevel Test: dOlMhCyzBPIxKGO4CTDq
Isla Blanca: V9kOoUXOU3jKjuvzg3sN
Nikki Ocean: ftdXjrhF7nXY6EWVpWN1
```

Los agentes del alcance quedaron cargados en `apps/api/src/routes/webhooks.ts`. Para Nikki Ocean se respetan los primeros 5 por prioridad porque el RR actual de Revenio limita el pool a 5 agentes.

La cuenta `GoHighLevel Test` usa agentes configurables por variables de entorno para evitar hardcodear usuarios de prueba.

## Variables requeridas

API keys por propiedad:

```bash
GHL_TEST_API_KEY=pit_...
GHL_ISLA_BLANCA_API_KEY=pit_...
GHL_NIKKI_OCEAN_API_KEY=pit_...
```

Agentes de prueba:

```bash
GHL_TEST_AGENT_1_NAME=...
GHL_TEST_AGENT_1_GHL_USER_ID=...
GHL_TEST_AGENT_1_PHONE=+52...

GHL_TEST_AGENT_2_NAME=...
GHL_TEST_AGENT_2_GHL_USER_ID=...
GHL_TEST_AGENT_2_PHONE=+52...
```

Stage destino cuando Revenio conecta:

```bash
GHL_TEST_CONNECTED_STAGE_ID=...
GHL_ISLA_BLANCA_CONNECTED_STAGE_ID=...
GHL_NIKKI_OCEAN_CONNECTED_STAGE_ID=...
```

Campo custom de opportunity para transcript:

```bash
GHL_TEST_TRANSCRIPT_FIELD_ID=...
GHL_ISLA_BLANCA_TRANSCRIPT_FIELD_ID=...
GHL_NIKKI_OCEAN_TRANSCRIPT_FIELD_ID=...
```

Opcional, para limitar disparo a un stage especifico:

```bash
GHL_TEST_TRIGGER_STAGE_ID=...
GHL_ISLA_BLANCA_TRIGGER_STAGE_ID=...
GHL_NIKKI_OCEAN_TRIGGER_STAGE_ID=...
```

Horario pedido por alcance:

```bash
BUSINESS_TZ=America/Mexico_City
BUSINESS_START_HOUR=9
BUSINESS_END_HOUR=18
BUSINESS_DAYS=1,2,3,4,5,6
```

## Salida hacia GHL

Cuando Revenio confirma transferencia humana, intenta actualizar la oportunidad:

```text
PUT /opportunities/:id
```

Campos enviados:

```json
{
  "assignedTo": "<ghl_user_id_del_agente_que_contesto>",
  "pipelineStageId": "<Contacto vendedor - Llamada>",
  "customFields": [
    {
      "id": "<Llamada de contacto inicial>",
      "field_value": "<transcript>"
    }
  ]
}
```

Si nadie contesta, no se empuja nada a GHL.

## Pendientes externos

- Confirmar IDs de stage `Contacto vendedor - Llamada` para ambas propiedades.
- Confirmar ID del custom field `Llamada de contacto inicial` para ambas propiedades.
- Para la cuenta test, crear/confirmar un stage destino y custom field equivalentes si se quiere probar el push de regreso.
- Para la cuenta test, configurar al menos un agente con `GHL_TEST_AGENT_1_*`.
- Confirmar si Omar Sanchez queda fuera del pool de Nikki Ocean o si se amplia Revenio a mas de 5 agentes.
- Confirmar payload real del webhook en producción.
