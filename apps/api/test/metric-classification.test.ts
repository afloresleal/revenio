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
    postTransferDurationSec: 29,
  }),
  {
    outcome: "completed",
    sentiment: "neutral",
    hasConnectedTransfer: false,
  },
  "a completed transfer leg under 30 seconds must not count as connected",
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
    postTransferDurationSec: 30,
  }),
  {
    outcome: "transfer_success",
    sentiment: "positive",
    hasConnectedTransfer: true,
  },
  "30 seconds with a human agent should count as connected",
);

console.log("metric classification tests passed");
