# GHL Demo Handoff - 2026-05-03

## Start here if opening a new Codex chat

Current branch/workflow:

- Work is on `develop`, because `develop` is the staging branch used for Railway tests.
- Backup branch only: `codex/backup-develop-2026-05-03`.
- Prepared local commit, not pushed yet: `feat(ghl): add campaign-specific Vapi routing`.
- API build passed before commit: `npm -w apps/api run build`.
- The user plans to push later after creating the four Vapi assistants and collecting their IDs.

What changed in the commit:

- `apps/api/src/routes/webhooks.ts` now accepts `campaignId` from GHL Custom Data.
- Known campaign IDs:
  - `isla-blanca-es`
  - `isla-blanca-en`
  - `nikki-ocean-es`
  - `nikki-ocean-en`
- `campaignId` selects campaign-specific Vapi assistant and phone number through Railway variables.
- If `campaignId` is missing or unknown, the old `locationId` + global `VAPI_ASSISTANT_ID` / `VAPI_PHONE_NUMBER_ID` fallback remains.
- GHL still assigns the human seller with `assignedTo`; Revenio maps `assignedTo` to the human transfer number.

Immediate next steps:

1. Create/configure the four Vapi assistants.
2. For each assistant, set the staging Server URL to `https://revenioapi-staging.up.railway.app/webhooks/vapi/events`.
3. Disable `phone-call-control` in Vapi Server Messages.
4. Avoid hardcoded Vapi forwarding/fallback numbers and duplicate native `transferCall` tools.
5. Add the four campaign-specific Vapi IDs in Railway staging.
6. Add `campaignId` Custom Data to each GHL workflow.
7. Push `develop` and test each campaign from GHL.

Railway variables needed for the new multi-campaign routing:

```bash
GHL_CAMPAIGN_IB_ES_VAPI_ASSISTANT_ID=
GHL_CAMPAIGN_IB_ES_VAPI_PHONE_NUMBER_ID=
GHL_CAMPAIGN_IB_EN_VAPI_ASSISTANT_ID=
GHL_CAMPAIGN_IB_EN_VAPI_PHONE_NUMBER_ID=
GHL_CAMPAIGN_NO_ES_VAPI_ASSISTANT_ID=
GHL_CAMPAIGN_NO_ES_VAPI_PHONE_NUMBER_ID=
GHL_CAMPAIGN_NO_EN_VAPI_ASSISTANT_ID=
GHL_CAMPAIGN_NO_EN_VAPI_PHONE_NUMBER_ID=
```

Optional but recommended for auditability:

```bash
GHL_CAMPAIGN_IB_ES_ID=isla-blanca-es
GHL_CAMPAIGN_IB_ES_PROPERTY_KEY=isla_blanca
GHL_CAMPAIGN_IB_EN_ID=isla-blanca-en
GHL_CAMPAIGN_IB_EN_PROPERTY_KEY=isla_blanca
GHL_CAMPAIGN_NO_ES_ID=nikki-ocean-es
GHL_CAMPAIGN_NO_ES_PROPERTY_KEY=nikki_ocean
GHL_CAMPAIGN_NO_EN_ID=nikki-ocean-en
GHL_CAMPAIGN_NO_EN_PROPERTY_KEY=nikki_ocean
```

Files most relevant for next chat:

- `apps/api/src/routes/webhooks.ts`
- `docs/GHL-KRP-INTEGRATION.md`
- `docs/VAPI-CONFIG.md`
- `docs/CALL-TRANSFER-HANDOFF-2026-04-08.md`
- `docs/GHL-DEMO-HANDOFF-2026-05-03.md`

## Objetivo

Demo de integracion GoHighLevel -> Revenio -> Vapi:

1. GHL crea/asigna oportunidad.
2. GHL dispara webhook a Revenio.
3. Revenio crea llamada outbound al lead.
4. Vapi confirma identidad del lead.
5. Vapi transfiere al asesor humano asignado por round robin de GHL/Revenio.
6. Revenio registra metricas, transcript y recording para dashboard.

## Ambientes

- API staging Railway: `https://revenioapi-staging.up.railway.app`
- Lab staging Railway: `https://revenio-lab-staging.up.railway.app`
- Dashboard staging Railway: `https://revenio-dashboard-staging.up.railway.app`
- GHL webhook: `POST /webhooks/gohighlevel`
- Vapi events webhook staging: `https://revenioapi-staging.up.railway.app/webhooks/vapi/events`
- Vapi events webhook production: `https://revenioapi-production.up.railway.app/webhooks/vapi/events`
- Branch principal usado: `develop`

## GHL test config

- Location ID: `dOlMhCyzBPIxKGO4CTDq`
- Pipeline ID: `y1d5iqHAz5WE5hdjpyia`
- Trigger stage `New Lead`: `fe4e865c-c8e7-4747-b2b2-a1ed3baebb6e`
- Connected stage `Contacted`: `c60834fb-1346-4a69-8da1-46e834a937b7`
- Test GHL user Ale: `o6mW3ERlbWe49dW9rhKJ`

## Multi-campaign Custom Data

For the KRP demo, every GHL workflow must send one `campaignId` in the webhook Custom Data.

Validated campaign IDs:

- `isla-blanca-es`
- `isla-blanca-en`
- `nikki-ocean-es`
- `nikki-ocean-en`

Example GHL Custom Data row:

```text
campaignId = nikki-ocean-en
```

Revenio uses `campaignId` to select the Vapi assistant and phone number. GHL still assigns the human agent through `assignedTo`, and Revenio maps that `assignedTo` to the transfer phone.

## Vapi test config validated on staging

- Assistant: `Brenda - EN - Caribbean Luxury`
- Assistant ID: `5ac0c5dd-2e79-4d29-b76a-add2ff1b93b7`
- Phone number ID: `56a80999-3361-4501-ae74-f23beaea1c41`
- Phone number name: `Twilio - Marina Casalba`
- Railway staging variable:
  - `VAPI_ASSISTANT_ID=5ac0c5dd-2e79-4d29-b76a-add2ff1b93b7`
- For multi-campaign staging, prefer campaign-specific Railway variables:
  - `GHL_CAMPAIGN_IB_ES_VAPI_ASSISTANT_ID`
  - `GHL_CAMPAIGN_IB_EN_VAPI_ASSISTANT_ID`
  - `GHL_CAMPAIGN_NO_ES_VAPI_ASSISTANT_ID`
  - `GHL_CAMPAIGN_NO_EN_VAPI_ASSISTANT_ID`
  - matching `GHL_CAMPAIGN_*_VAPI_PHONE_NUMBER_ID`
- Required Vapi assistant settings for staging tests:
  - Server URL: `https://revenioapi-staging.up.railway.app/webhooks/vapi/events`
  - Timeout: prefer `10` to `30` seconds, not `1` second.
  - `phone-call-control` must be disabled in Server Messages.
  - Keep `transfer-update`, `transfer-destination-request`, `speech-update`, `end-of-call-report`, and `tool-calls` enabled.
  - Do not configure `Forwarding Phone Number` / fallback destination to a fixed advisor number for this flow.
  - Do not assign a second native `Transfer Call` tool with a hardcoded destination. Revenio injects the runtime `transferCall` tool and destination.

## Relevant commits

- `70ec4f2` - `feat(transfer): add blind-transfer mode to destinations`
  - Added `transferPlan` in `apps/api/src/server.ts` and `droplet-caller/index.js`.
  - Did not affect GHL webhook path.
- `e4d826b` - `fix: include blind transfer plan in GHL webhook calls`
  - Added `transferPlan` to `apps/api/src/routes/webhooks.ts`.
- `bb507c3` - `fix: use dial transfer for GHL PSTN handoff`
  - Forced `sipVerb: 'dial'` inside GHL webhook dynamic transfer destination.

## Current Revenio override shape

The GHL webhook should create Vapi calls with this shape:

```json
{
  "assistantOverrides": {
    "model": {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "tools": [
        {
          "type": "transferCall",
          "destinations": [
            {
              "type": "number",
              "number": "+52...",
              "transferPlan": {
                "mode": "blind-transfer",
                "sipVerb": "dial"
              }
            }
          ]
        }
      ]
    },
    "metadata": {
      "lead_id": "...",
      "attempt_id": "..."
    },
    "variableValues": {
      "name": "...",
      "agent_name": "...",
      "transfer_number": "+52..."
    }
  }
}
```

## What has been validated

- GHL reaches Revenio webhook.
- Revenio returns success and creates Vapi outbound call.
- Lead phone and assigned agent phone are parsed correctly.
- Revenio injects dynamic transfer destination.
- Vapi accepts the call creation request with `201`.
- Vapi calls the lead.
- Brenda calls `transferCall` after the first message.
- Vapi transfers to the GHL/Revenio-selected advisor number when the assistant Server URL points to staging.
- Dashboard/API can show new Vapi call records via `/api/metrics/recent`.
- Validated successful staging call:
  - Vapi call creation response ID: `019df037-23b8-7bbe-8b1a-8dd68849d148`
  - Assistant ID: `5ac0c5dd-2e79-4d29-b76a-add2ff1b93b7`
  - Selected agent: `Ale Flores`
  - Dynamic transfer number: `+525527026617`

## Resolved issues from 2026-05-03 testing

### Duplicate transferCall tool

Vapi rejects call creation when the assistant has more than one `transferCall` tool.

Observed error:

```json
{
  "statusCode": 400,
  "message": "Invalid Configuration. Assistant 'Marina - Casalba Los Cabos' has more than one tool of type 'transferCall'."
}
```

Fix for this flow:

- Keep the dynamic `transferCall` sent by Revenio in `assistantOverrides.model.tools`.
- Do not also assign a native Vapi `Transfer Call` tool with the same type to the assistant, unless the code is changed to use Vapi's `transfer-destination-request` pattern instead.

### `phone-call-control` blocks transfer behavior

Transfer started working only after removing `phone-call-control` from Vapi Server Messages.

Required setting:

- Vapi Assistant -> Advanced -> Messaging -> Server Messages
- Disable: `phone-call-control`
- Keep enabled: `transfer-update`, `transfer-destination-request`, `speech-update`, `tool-calls`, `end-of-call-report`

### Staging assistant was pointing events to production

One failed test used the correct Brenda assistant and accepted the dynamic transfer number, but the assistant Server URL pointed to production:

- Wrong for staging: `https://revenioapi-production.up.railway.app/webhooks/vapi/events`
- Correct for staging: `https://revenioapi-staging.up.railway.app/webhooks/vapi/events`

Symptom:

- Vapi log showed `forwardedPhoneNumber: "+525527326714"` instead of the Revenio-selected advisor number.
- Vapi call had `endedReason: "assistant-forwarded-call"` but used the assistant/phone fallback behavior.

Fix:

- Change Vapi Assistant Server URL to staging.
- Publish the assistant.
- Retest from GHL.

## Pre-test checklist for Vapi staging

Before running a GHL staging test:

1. Railway `revenioapi-staging` has `VAPI_ASSISTANT_ID=5ac0c5dd-2e79-4d29-b76a-add2ff1b93b7`.
2. Vapi Assistant `Brenda - EN - Caribbean Luxury` is published.
3. Vapi Assistant Server URL is `https://revenioapi-staging.up.railway.app/webhooks/vapi/events`.
4. Vapi Assistant Server timeout is at least `10` seconds.
5. `phone-call-control` is disabled in Server Messages.
6. There is no hardcoded `Forwarding Phone Number` / fallback advisor number on the assistant for this flow.
7. There is no duplicate native `Transfer Call` tool with a hardcoded destination.
8. The GHL test agent phone is set in Railway as `GHL_TEST_AGENT_1_PHONE` and appears in the call creation payload as:
   - `assistantOverrides.variableValues.transfer_number`
   - `assistantOverrides.model.tools[0].destinations[0].number`

## Expected successful evidence

After the GHL test:

- GHL/Revenio returns `201`.
- Request assistant ID is `5ac0c5dd-2e79-4d29-b76a-add2ff1b93b7`.
- Request includes:
  - `transferPlan.mode = blind-transfer`
  - `transferPlan.sipVerb = dial`
  - destination number equal to the selected GHL/Revenio advisor.
- Vapi final call log has:
  - `assistantId = 5ac0c5dd-2e79-4d29-b76a-add2ff1b93b7`
  - `endedReason = assistant-forwarded-call`
  - `forwardedPhoneNumber` equal to the selected advisor, not the lead/fallback phone.
- Dashboard/API shows the call via `/api/metrics/recent`.
