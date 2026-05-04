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

El endpoint espera `campaignId`, `locationId`, `id` de oportunidad, `assignedTo` y datos de contacto. Si el payload no trae `contact.phone`, intenta consultar `GET /contacts/:contactId` usando la API key de la propiedad.

Para el demo multi-campaña, cada workflow de GHL debe mandar `campaignId` en Custom Data:

```json
{
  "campaignId": "isla-blanca-es"
}
```

## Propiedades configuradas

```text
GoHighLevel Test: dOlMhCyzBPIxKGO4CTDq
Isla Blanca: V9kOoUXOU3jKjuvzg3sN
Nikki Ocean: ftdXjrhF7nXY6EWVpWN1
```

Los agentes del alcance quedaron cargados en `apps/api/src/routes/webhooks.ts`. Para Nikki Ocean se respetan los primeros 5 por prioridad porque el RR actual de Revenio limita el pool a 5 agentes.

La cuenta `GoHighLevel Test` usa agentes configurables por variables de entorno para evitar hardcodear usuarios de prueba.

## Campañas configuradas para demo

```text
isla-blanca-es -> Isla Blanca / assistant Vapi ES
isla-blanca-en -> Isla Blanca / assistant Vapi EN
nikki-ocean-es -> Nikki Ocean / assistant Vapi ES
nikki-ocean-en -> Nikki Ocean / assistant Vapi EN
```

Si `campaignId` viene y hace match, Revenio usa el assistant Vapi y phone number configurados para esa campaña. Si falta `campaignId`, el sistema usa el flujo anterior por `locationId` y las variables globales `VAPI_ASSISTANT_ID` / `VAPI_PHONE_NUMBER_ID`.

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

Vapi por campaña:

```bash
GHL_CAMPAIGN_IB_ES_ID=isla-blanca-es
GHL_CAMPAIGN_IB_ES_PROPERTY_KEY=isla_blanca
GHL_CAMPAIGN_IB_ES_VAPI_ASSISTANT_ID=...
GHL_CAMPAIGN_IB_ES_VAPI_PHONE_NUMBER_ID=...

GHL_CAMPAIGN_IB_EN_ID=isla-blanca-en
GHL_CAMPAIGN_IB_EN_PROPERTY_KEY=isla_blanca
GHL_CAMPAIGN_IB_EN_VAPI_ASSISTANT_ID=...
GHL_CAMPAIGN_IB_EN_VAPI_PHONE_NUMBER_ID=...

GHL_CAMPAIGN_NO_ES_ID=nikki-ocean-es
GHL_CAMPAIGN_NO_ES_PROPERTY_KEY=nikki_ocean
GHL_CAMPAIGN_NO_ES_VAPI_ASSISTANT_ID=...
GHL_CAMPAIGN_NO_ES_VAPI_PHONE_NUMBER_ID=...

GHL_CAMPAIGN_NO_EN_ID=nikki-ocean-en
GHL_CAMPAIGN_NO_EN_PROPERTY_KEY=nikki_ocean
GHL_CAMPAIGN_NO_EN_VAPI_ASSISTANT_ID=...
GHL_CAMPAIGN_NO_EN_VAPI_PHONE_NUMBER_ID=...
```

Los nombres/campaign IDs tienen defaults en código, pero en Railway conviene declararlos explícitamente para que el setup sea auditable.

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
- Configurar `campaignId` en Custom Data para los 4 workflows de demo.
- Cargar los 4 `GHL_CAMPAIGN_*_VAPI_ASSISTANT_ID` correctos en Railway.
