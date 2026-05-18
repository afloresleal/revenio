import assert from "node:assert/strict";

// Make the global schedule reject Sunday so the campaign override has to win.
process.env.BUSINESS_HOURS_ENABLED = "true";
process.env.BUSINESS_TZ = "America/Mexico_City";
process.env.BUSINESS_START_HOUR = "9";
process.env.BUSINESS_END_HOUR = "22";
process.env.BUSINESS_DAYS = "1,2,3,4,5,6";
process.env.BUSINESS_APPLY_TO_RR_FAILOVER = "true";

const { evaluateRoundRobinFailoverWindow } = await import("../src/lib/round-robin-window.js");

const sundayEvening = new Date("2026-05-18T03:21:53.000Z"); // 2026-05-17 21:21 in Mexico City

const globalOnly = evaluateRoundRobinFailoverWindow({
  campaign: null,
  now: sundayEvening,
});
assert.equal(globalOnly.allowed, false, "global schedule should reject Sunday");
assert.equal(globalOnly.reason, "inactive_weekday");

const campaignOverride = evaluateRoundRobinFailoverWindow({
  campaign: {
    callWindowEnabled: true,
    callWindowTimezone: "America/Mexico_City",
    callWindowStartHour: 9,
    callWindowEndHour: 22,
    callWindowWeekdays: "0,1,2,3,4,5,6",
    callWindowApplyToFailover: true,
  },
  now: sundayEvening,
});
assert.equal(
  campaignOverride.allowed,
  true,
  "campaign-specific Sunday hours should allow RR failover even when global hours reject Sunday",
);
assert.deepEqual(campaignOverride.settings.activeWeekdays, [0, 1, 2, 3, 4, 5, 6]);

console.log("round robin window tests passed");
