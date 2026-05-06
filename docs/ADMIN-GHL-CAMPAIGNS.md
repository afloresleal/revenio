# Admin GHL Campaigns

> Estado: guía operativa vigente para demos GHL desde Admin.

## Regla principal

Admin es la fuente de verdad para campañas GHL, vendedores humanos y fallback final. Railway no debe guardar números de vendedores, clientes, campañas ni IDs por propiedad para demos nuevos.

Railway conserva solo secretos e infraestructura:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `VAPI_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- URLs base públicas necesarias para webhooks
- configuración técnica de transcripción/horarios

## Alta de campaña

En Admin, crear una campaña con:

- Cliente
- Nombre de campaña
- `Campaign ID`
- `GHL Location ID`
- `Vapi Assistant ID`
- `Vapi Phone Number ID`
- Idioma
- Status activa/pausada

El nombre de campaña puede representar la propiedad o desarrollo inmobiliario. No hace falta un campo separado de propiedad si el `Campaign ID` y el `GHL Location ID` ya identifican el flujo.

## Agentes humanos

Por campaña, capturar hasta 5 vendedores:

- Nombre
- Teléfono en formato E.164, por ejemplo `+525512345678`
- `GHL User ID`
- Activo/inactivo

El `GHL User ID` permite respetar `assignedTo` cuando GHL ya asignó la oportunidad. El fallback final se captura aparte y se usa solo cuando ningún vendedor contesta. Su `GHL User ID` es opcional.

## Webhook de GHL

Admin genera el entregable para configurar la acción Webhook en GoHighLevel.

Para staging:

```text
POST https://revenioapi-staging.up.railway.app/webhooks/gohighlevel
```

Custom Data mínimo:

| Key | Value |
| --- | --- |
| `type` | `OpportunityAssignedTo` |
| `campaignId` | ID exacto creado en Admin |
| `locationId` | Location ID de GHL |
| `id` | `{{ opportunity.id }}` |
| `assignedTo` | usuario asignado por GHL, si está disponible |
| `contactId` | `{{ contact.id }}` |
| `firstName` | `{{ contact.first_name }}` |
| `lastName` | `{{ contact.last_name }}` |
| `phone` | `{{ contact.phone }}` |
| `email` | `{{ contact.email }}` |

## Routing

```text
assignedTo de GHL con match en Admin
  -> resto de vendedores activos de la campaña
  -> fallback final
```

Si `assignedTo` viene vacío o no coincide:

```text
primer vendedor activo de la campaña
  -> resto de vendedores activos
  -> fallback final
```

Si la campaña está pausada, Revenio ignora el webhook y no llama al lead.

## Pendiente

- Autenticación propia de Admin.
- Modelo formal `Client`.
- Confirmar campos finales para push post-llamada hacia GHL: API key, stage conectado y transcript custom field.
