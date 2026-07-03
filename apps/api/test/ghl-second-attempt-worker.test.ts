import assert from "node:assert/strict";
import {
  DEFAULT_GHL_SECOND_ATTEMPT_WORKER_INTERVAL_MS,
  resolveGhlSecondAttemptWorkerConfig,
} from "../src/lib/ghl-second-attempt-worker.js";

assert.deepEqual(
  resolveGhlSecondAttemptWorkerConfig({}),
  {
    enabled: true,
    pollIntervalMs: DEFAULT_GHL_SECOND_ATTEMPT_WORKER_INTERVAL_MS,
  },
  "worker should default to enabled with the standard polling interval",
);

assert.deepEqual(
  resolveGhlSecondAttemptWorkerConfig({
    GHL_SECOND_ATTEMPT_WORKER_ENABLED: "false",
    GHL_SECOND_ATTEMPT_WORKER_INTERVAL_MS: "500",
  }),
  {
    enabled: false,
    pollIntervalMs: 1_000,
  },
  "worker should allow disabling and clamp very low intervals",
);

assert.deepEqual(
  resolveGhlSecondAttemptWorkerConfig({
    GHL_SECOND_ATTEMPT_WORKER_ENABLED: "1",
    GHL_SECOND_ATTEMPT_WORKER_INTERVAL_MS: "120000",
  }),
  {
    enabled: true,
    pollIntervalMs: 60_000,
  },
  "worker should clamp very high intervals",
);

console.log("ghl-second-attempt-worker tests passed");
