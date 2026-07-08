import assert from "node:assert/strict";
import { buildAssistantOverrides } from "../src/routes/webhooks.js";

const overrides = buildAssistantOverrides(
  "Ale",
  "lead-1",
  "attempt-1",
  "+525512345678",
  "Marina",
);

assert.deepEqual(
  overrides,
  {
    metadata: {
      lead_id: "lead-1",
      attempt_id: "attempt-1",
    },
    variableValues: {
      name: "Ale",
      transfer_number: "+525512345678",
      agent_name: "Marina",
    },
  },
  "assistant overrides should not inject a forced transfer hook for outbound GHL calls",
);

console.log("webhooks assistant overrides tests passed");
