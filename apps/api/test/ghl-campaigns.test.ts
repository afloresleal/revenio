import assert from "node:assert/strict";
import {
  buildCampaignCallsCsv,
  buildGhlWebhookInstructions,
  getGhlCampaignRuntimeStatus,
  normalizeStoredGhlCampaign,
  selectCampaignTestTransfer,
} from "../src/lib/ghl-campaigns.js";

const campaign = normalizeStoredGhlCampaign({
  id: "campaign-db-id",
  campaignId: "isla-blanca-es",
  clientName: "Caribbean Luxury Homes",
  propertyKey: "isla_blanca",
  name: "Isla Blanca ES",
  language: "es",
  vapiAssistantId: "assistant-123",
  vapiPhoneNumberId: "phone-123",
  ghlLocationId: "location-123",
  ghlPipelineId: "pipeline-123",
  ghlStageId: "stage-123",
  active: true,
});

assert.equal(campaign?.campaignId, "isla-blanca-es");
assert.equal(campaign?.clientName, "Caribbean Luxury Homes");
assert.equal(campaign?.vapiAssistantId, "assistant-123");
assert.deepEqual(getGhlCampaignRuntimeStatus(campaign!), { allowed: true });

const pausedCampaign = normalizeStoredGhlCampaign({
  id: "campaign-db-id",
  campaignId: "isla-blanca-paused",
  propertyKey: "isla_blanca",
  name: "Isla Blanca Paused",
  language: "es",
  vapiAssistantId: "assistant-123",
  vapiPhoneNumberId: "phone-123",
  active: false,
});

assert.deepEqual(getGhlCampaignRuntimeStatus(pausedCampaign!), {
  allowed: false,
  reason: "campaign_inactive",
});

const instructions = buildGhlWebhookInstructions(campaign!);

assert.equal(instructions.method, "POST");
assert.equal(instructions.stagingUrl, "https://revenioapi-staging.up.railway.app/webhooks/gohighlevel");
assert.deepEqual(
  instructions.customDataRows.slice(0, 5),
  [
    { key: "type", value: "OpportunityAssignedTo" },
    { key: "campaignId", value: "isla-blanca-es" },
    { key: "locationId", value: "location-123" },
    { key: "id", value: "{{ opportunity.id }}" },
    { key: "assignedTo", value: "{{ opportunity.assigned_to }}" },
  ],
);
assert.equal(
  instructions.customDataRows.find((row) => row.key === "pipelineId")?.value,
  "pipeline-123",
);
assert.equal(
  instructions.customDataRows.find((row) => row.key === "stageId")?.value,
  "stage-123",
);

assert.equal(
  instructions.validations[0],
  "campaignId debe coincidir exactamente con la campana creada en Admin.",
);

const transfer = selectCampaignTestTransfer({
  agents: [
    { name: "Inactive", transferNumber: "+525500000000", active: false, priority: 1 },
    { name: "Primary Seller", ghlUserId: "primary-ghl", transferNumber: "+525511111111", active: true, priority: 2 },
  ],
  fallback: { name: "Marketing Manager", transferNumber: "+525522222222" },
});

assert.deepEqual(transfer, {
  name: "Primary Seller",
  ghlUserId: "primary-ghl",
  transferNumber: "+525511111111",
  source: "agent",
});

const fallbackTransfer = selectCampaignTestTransfer({
  agents: [{ name: "Inactive", transferNumber: "+525500000000", active: false, priority: 1 }],
  fallback: { name: "Marketing Manager", ghlUserId: "manager-ghl", transferNumber: "+525522222222" },
});

assert.deepEqual(fallbackTransfer, {
  name: "Marketing Manager",
  ghlUserId: "manager-ghl",
  transferNumber: "+525522222222",
  source: "fallback",
});

const callsCsv = buildCampaignCallsCsv([
  {
    campaignName: "Isla Blanca ES",
    campaignId: "isla-blanca-es",
    startedAt: new Date("2026-05-05T19:00:00.000Z"),
    phone: "+525500000001",
    outcome: "transfer_success",
    sentiment: "positive",
    assignedTo: "ana-ghl",
    firstAgentName: "Ana",
    answeredAgentName: "Luis, Ventas",
    transferNumber: "+525500000002",
    durationSec: 120,
    timeToTransferSec: 18,
    sellerTalkSec: 91,
    transcript: "Hola\nmundo",
    recordingUrl: "https://example.com/audio.mp3",
  },
]);

assert.equal(
  callsCsv,
  [
    "campaign_name,campaign_id,started_at,lead_phone,outcome,sentiment,assigned_to,first_agent,answered_agent,transfer_number,total_duration_sec,time_to_transfer_sec,seller_talk_sec,transcript,recording_url",
    "Isla Blanca ES,isla-blanca-es,2026-05-05T19:00:00.000Z,+525500000001,transfer_success,positive,ana-ghl,Ana,\"Luis, Ventas\",+525500000002,120,18,91,Hola mundo,https://example.com/audio.mp3",
  ].join("\n"),
);

console.log("ghl-campaigns tests passed");
