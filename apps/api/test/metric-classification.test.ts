import assert from "node:assert/strict";
import { normalizeMetricClassification } from "../src/lib/metric-classification.js";

assert.deepEqual(
  normalizeMetricClassification({
    outcome: "completed",
    sentiment: "neutral",
    endedReason: "assistant-forwarded-call",
    transferredAt: new Date("2026-05-16T18:30:19.795Z"),
    endedAt: new Date("2026-05-16T18:30:28.538Z"),
    twilioTransferCallSid: "CA-transfer",
    transferStatus: "completed",
    postTransferDurationSec: 8,
  }),
  {
    outcome: "completed",
    sentiment: "neutral",
    hasConnectedTransfer: true,
  },
  "a completed transfer leg without confirmed human answer must not become transfer_success",
);

assert.deepEqual(
  normalizeMetricClassification({
    outcome: "transfer_success",
    sentiment: "positive",
    endedReason: "assistant-forwarded-call",
    transferredAt: new Date("2026-05-16T18:30:19.795Z"),
    endedAt: new Date("2026-05-16T18:30:28.538Z"),
    twilioTransferCallSid: "CA-transfer",
    transferStatus: "completed",
    postTransferDurationSec: 8,
  }),
  {
    outcome: "transfer_success",
    sentiment: "positive",
    hasConnectedTransfer: true,
  },
  "explicit human-confirmed successes must remain transfer_success",
);

console.log("metric classification tests passed");
