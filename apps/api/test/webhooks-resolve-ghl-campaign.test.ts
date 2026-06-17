import assert from "node:assert/strict";

// Pin global call-window defaults to distinct values so test assertions
// fail loudly if resolveGhlCampaign stops propagating callWindow* fields
// (i.e., regress to the bug where campaign endHour:22 was overridden by
// global endHour:18). Must be set BEFORE call-window.ts is loaded.
process.env.BUSINESS_HOURS_ENABLED = "true";
process.env.BUSINESS_TZ = "UTC";
process.env.BUSINESS_START_HOUR = "7";
process.env.BUSINESS_END_HOUR = "18";
process.env.BUSINESS_DAYS = "0,1,2,3,4,5,6";
process.env.BUSINESS_APPLY_TO_RR_FAILOVER = "true";

const { prisma } = await import("../src/lib/prisma.js");
const { evaluateCallWindow, evaluateCampaignCallWindow } = await import(
  "../src/lib/call-window.js"
);
const { resolveGhlCampaign } = await import("../src/routes/webhooks.js");

function patchPrismaGhlCampaign(row: Record<string, unknown> | null) {
  (prisma as unknown as { ghlCampaign: { findUnique: (args: unknown) => Promise<unknown> } }).ghlCampaign = {
    findUnique: async (_args: unknown) => row,
  };
}

const fullCampaign = {
  id: "db-id-1",
  campaignId: "test-1",
  propertyKey: "test_property",
  name: "Test Campaign",
  language: "es",
  vapiAssistantId: "assistant-1",
  vapiPhoneNumberId: "phone-1",
  ghlLocationId: "loc-1",
  ghlApiKey: "key-1",
  ghlPipelineId: "pipe-1",
  ghlStageId: "stage-1",
  ghlConnectedStageId: "connected-1",
  ghlStageMapping: null,
  ghlOutcomeFieldId: "outcome-1",
  ghlSellerTalkFieldId: "seller-1",
  ghlRecordingUrlFieldId: "recording-1",
  autoWarmTransferEnabled: false,
  callWindowEnabled: true,
  callWindowTimezone: "America/Mexico_City",
  callWindowStartHour: 9,
  callWindowEndHour: 22,
  callWindowWeekdays: "1,2,3,4,5",
  callWindowApplyToFailover: true,
  active: true,
};

// --- Test 1 (unit): resolveGhlCampaign propagates callWindow* fields ---
patchPrismaGhlCampaign(fullCampaign);
const resolved = await resolveGhlCampaign("test-1");
assert.ok(resolved, "expected campaign to resolve from mocked prisma");
assert.equal(resolved!.callWindowEnabled, true);
assert.equal(resolved!.callWindowTimezone, "America/Mexico_City");
assert.equal(resolved!.callWindowStartHour, 9);
assert.equal(resolved!.callWindowEndHour, 22);
assert.equal(resolved!.callWindowWeekdays, "1,2,3,4,5");
assert.equal(resolved!.callWindowApplyToFailover, true);
assert.equal(resolved!.autoWarmTransferEnabled, false);

// --- Test 2 (integration): webhook path honors campaign endHour:22, not global 18 ---
const evalCustom = evaluateCampaignCallWindow(resolved!);
assert.equal(
  evalCustom.settings.endHour,
  22,
  "evaluator must use campaign endHour:22, not global env endHour:18",
);
assert.equal(evalCustom.settings.startHour, 9);
assert.equal(evalCustom.settings.timezone, "America/Mexico_City");
assert.deepEqual(evalCustom.settings.activeWeekdays, [1, 2, 3, 4, 5]);
assert.equal(evalCustom.settings.applyToRoundRobinFailover, true);

// --- Test 3 (regression): all-null callWindow* falls back to global settings ---
const nullCampaign = {
  ...fullCampaign,
  campaignId: "test-null",
  callWindowEnabled: null,
  callWindowTimezone: null,
  callWindowStartHour: null,
  callWindowEndHour: null,
  callWindowWeekdays: null,
  callWindowApplyToFailover: null,
};
patchPrismaGhlCampaign(nullCampaign);
const resolvedNull = await resolveGhlCampaign("test-null");
assert.ok(resolvedNull, "expected null-callWindow campaign to resolve");
assert.equal(resolvedNull!.callWindowEnabled, null);
assert.equal(resolvedNull!.callWindowEndHour, null);

const evalNull = evaluateCampaignCallWindow(resolvedNull!);
const evalGlobal = evaluateCallWindow();
assert.equal(
  evalNull.settings.endHour,
  evalGlobal.settings.endHour,
  "null callWindowEnabled must fall back to global evaluateCallWindow",
);
assert.equal(evalNull.settings.startHour, evalGlobal.settings.startHour);
assert.equal(evalNull.settings.timezone, evalGlobal.settings.timezone);
assert.deepEqual(evalNull.settings.activeWeekdays, evalGlobal.settings.activeWeekdays);
assert.equal(evalNull.settings.endHour, 18, "global env BUSINESS_END_HOUR=18 must take effect");

console.log("webhooks resolveGhlCampaign tests passed (3/3)");
