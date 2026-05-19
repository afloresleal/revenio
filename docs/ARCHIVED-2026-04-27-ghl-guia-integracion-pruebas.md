Guía de Integración GoHighLevel — Revenio Voice Agent
(2026-04-27 — cuenta de pruebas, datos de ejemplo)

───

1. Acceso al Dashboard
• Dashboard: https://app.gohighlevel.com/v2/location/<GHL_TEST_LOCATION_ID>/dashboard
• Contactos: https://app.gohighlevel.com/v2/location/<GHL_TEST_LOCATION_ID>/contacts
• Pipeline: https://app.gohighlevel.com/v2/location/<GHL_TEST_LOCATION_ID>/opportunities
• Calendarios: https://app.gohighlevel.com/v2/location/<GHL_TEST_LOCATION_ID>/calendars

───

2. Credenciales de API
• API Key: <GHL_API_KEY>
• Location ID: <GHL_TEST_LOCATION_ID>
• Base URL: https://services.leadconnectorhq.com
• API Version header: Version: 2021-07-28

Headers requeridos en TODAS las llamadas:

Authorization: Bearer <GHL_API_KEY>
Version: 2021-07-28
Accept: application/json
───

3. Estado de la cuenta
• 5 contactos de ejemplo (Contacto A, Contacto B, Contacto C, Contacto D, Contacto E)
• 1 Pipeline: "Marketing Pipeline" (<GHL_PIPELINE_ID>)
→ Stages: New Lead → Contacted → Qualified → Proposal Sent → Negotiation → Closed
• 1 Calendario: "<USUARIO_INTERNO>'s Personal Calendar" (<GHL_CALENDAR_ID>)

───

4. Endpoints clave

Crear/actualizar contacto (upsert):

POST https://services.leadconnectorhq.com/contacts/upsert
{
  "firstName": "Juan",
  "lastName": "Pérez",
  "phone": "<PHONE_E164>",
  "locationId": "<GHL_TEST_LOCATION_ID>"
}
Crear oportunidad en pipeline:

POST https://services.leadconnectorhq.com/opportunities/
{
  "pipelineId": "<GHL_PIPELINE_ID>",
  "locationId": "<GHL_TEST_LOCATION_ID>",
  "name": "Lead: <NOMBRE_DE_EJEMPLO>",
  "contactId": "<id del contacto>",
  "status": "open"
}
Agregar nota a contacto:

POST https://services.leadconnectorhq.com/contacts/<contactId>/notes
{
  "body": "Llamada via Voice Agent — interesado en propiedad X"
}
Agendar cita:

POST https://services.leadconnectorhq.com/calendars/events/appointments
{
  "calendarId": "<GHL_CALENDAR_ID>",
  "locationId": "<GHL_TEST_LOCATION_ID>",
  "contactId": "<id>",
  "startTime": "2026-04-28T10:00:00-06:00",
  "endTime": "2026-04-28T10:30:00-06:00",
  "title": "Seguimiento Voice Agent"
}
───

5. Flujo Voice Agent → GHL

Assistant EN 1 habla con lead
  1. POST /contacts/upsert      → crear/actualizar lead
  2. POST /opportunities/        → agregar a pipeline
  3. POST /contacts/{id}/notes   → guardar resumen de llamada
  4. POST /calendars/events      → agendar cita (si aplica)
───

6. Test rápido de conexión (copia en terminal):

curl -s "https://services.leadconnectorhq.com/contacts/?locationId=<GHL_TEST_LOCATION_ID>&limit=1" \
  -H "Authorization: Bearer <GHL_API_KEY>" \
  -H "Version: 2021-07-28" | python3 -m json.tool
Si responde con "contacts": [...] → conexión OK :white_check_mark: