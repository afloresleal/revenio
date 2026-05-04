# Multi-Campaign MVP Design

## Goal

Support the KRP demo with four GHL campaigns in one Revenio API deployment, without changing Railway variables between tests.

The four campaign slugs are:

- `isla-blanca-es`
- `isla-blanca-en`
- `nikki-ocean-es`
- `nikki-ocean-en`

## Scope

This is a demo-focused multi-campaign MVP, not the full multi-client admin system.

Included:

- GHL webhook accepts `campaignId` from Custom Data.
- Revenio resolves campaign-specific Vapi assistant and phone number.
- Revenio keeps the existing GHL agent assignment behavior: GHL provides `assignedTo`; Revenio maps it to the campaign's human-agent phone and sends that number to Vapi.
- Existing behavior remains as fallback when `campaignId` is missing.
- Documentation lists the Railway variables and GHL Custom Data fields needed for tests.

Deferred:

- Database models for Client/Campaign.
- Admin UI for campaign management.
- Per-campaign analytics filters in dashboard.

## Campaign Resolution

GHL sends `campaignId` in webhook Custom Data:

```json
{
  "campaignId": "isla-blanca-es"
}
```

Revenio first looks for a matching campaign config. If found, it uses that config for:

- `vapiAssistantId`
- `vapiPhoneNumberId`
- parent GHL property config
- human-agent pool

If no matching campaign config exists, Revenio falls back to current `locationId` property resolution and global `VAPI_ASSISTANT_ID` / `VAPI_PHONE_NUMBER_ID`.

## Railway Variable Shape

Campaigns use short stable codes:

- `IB_ES`
- `IB_EN`
- `NO_ES`
- `NO_EN`

Each campaign supports:

```env
GHL_CAMPAIGN_IB_ES_ID=isla-blanca-es
GHL_CAMPAIGN_IB_ES_PROPERTY_KEY=isla_blanca
GHL_CAMPAIGN_IB_ES_VAPI_ASSISTANT_ID=...
GHL_CAMPAIGN_IB_ES_VAPI_PHONE_NUMBER_ID=...
```

Agent overrides are optional for the MVP. If campaign-specific agents are not configured, the campaign uses the parent property agents already defined for Isla Blanca or Nikki Ocean.

## Vapi Requirements

Each Vapi assistant used by the four campaigns must be configured for the matching environment:

- Staging Server URL: `https://revenioapi-staging.up.railway.app/webhooks/vapi/events`
- `phone-call-control` disabled.
- No hardcoded forwarding/fallback advisor for GHL flow.
- No duplicate native `transferCall` tool with a hardcoded destination when Revenio sends `assistantOverrides.model.tools`.

## Success Criteria

- GHL can trigger each of the four campaigns by sending the right `campaignId`.
- The Vapi call creation request uses the campaign-specific `assistantId`.
- The dynamic transfer number still matches the GHL-assigned human agent.
- A missing/unknown `campaignId` does not break the current test flow.
