import assert from "node:assert/strict";
import {
  DEFAULT_CALL_METRICS_SYNC_WORKER_INTERVAL_MS,
  DEFAULT_CALL_METRICS_SYNC_WORKER_LOOKBACK_MINUTES,
  DEFAULT_CALL_METRICS_SYNC_WORKER_LIMIT,
  resolveCallMetricsSyncWorkerConfig,
} from "../src/lib/call-metrics-sync-worker.js";

assert.deepEqual(
  resolveCallMetricsSyncWorkerConfig({}),
  {
    enabled: true,
    pollIntervalMs: DEFAULT_CALL_METRICS_SYNC_WORKER_INTERVAL_MS,
    lookbackMinutes: DEFAULT_CALL_METRICS_SYNC_WORKER_LOOKBACK_MINUTES,
    limit: DEFAULT_CALL_METRICS_SYNC_WORKER_LIMIT,
  },
  "call metrics sync worker should default to enabled with standard polling settings",
);

assert.deepEqual(
  resolveCallMetricsSyncWorkerConfig({
    CALL_METRICS_SYNC_WORKER_ENABLED: "false",
    CALL_METRICS_SYNC_WORKER_INTERVAL_MS: "500",
    CALL_METRICS_SYNC_WORKER_LOOKBACK_MINUTES: "1",
    CALL_METRICS_SYNC_WORKER_LIMIT: "0",
  }),
  {
    enabled: false,
    pollIntervalMs: 1_000,
    lookbackMinutes: 5,
    limit: 1,
  },
  "call metrics sync worker should allow disabling and clamp low values",
);

assert.deepEqual(
  resolveCallMetricsSyncWorkerConfig({
    CALL_METRICS_SYNC_WORKER_ENABLED: "1",
    CALL_METRICS_SYNC_WORKER_INTERVAL_MS: "120000",
    CALL_METRICS_SYNC_WORKER_LOOKBACK_MINUTES: "20000",
    CALL_METRICS_SYNC_WORKER_LIMIT: "500",
  }),
  {
    enabled: true,
    pollIntervalMs: 60_000,
    lookbackMinutes: 1_440,
    limit: 100,
  },
  "call metrics sync worker should clamp very high values",
);

console.log("call metrics sync worker tests passed");
