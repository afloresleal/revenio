import { syncRecentIncompleteCallMetrics } from "../routes/metrics.js";

export const DEFAULT_CALL_METRICS_SYNC_WORKER_INTERVAL_MS = 15_000;
export const DEFAULT_CALL_METRICS_SYNC_WORKER_LOOKBACK_MINUTES = 180;
export const DEFAULT_CALL_METRICS_SYNC_WORKER_LIMIT = 25;
const MIN_CALL_METRICS_SYNC_WORKER_INTERVAL_MS = 1_000;
const MAX_CALL_METRICS_SYNC_WORKER_INTERVAL_MS = 60_000;
const MIN_CALL_METRICS_SYNC_WORKER_LOOKBACK_MINUTES = 5;
const MAX_CALL_METRICS_SYNC_WORKER_LOOKBACK_MINUTES = 1_440;
const MIN_CALL_METRICS_SYNC_WORKER_LIMIT = 1;
const MAX_CALL_METRICS_SYNC_WORKER_LIMIT = 100;

type WorkerEnv = Record<string, string | undefined>;

type WorkerConfig = {
  enabled: boolean;
  pollIntervalMs: number;
  lookbackMinutes: number;
  limit: number;
};

function parseBoolean(value: string | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function resolveCallMetricsSyncWorkerConfig(env: WorkerEnv): WorkerConfig {
  const enabled = parseBoolean(env.CALL_METRICS_SYNC_WORKER_ENABLED) ?? true;
  const rawInterval = Number(env.CALL_METRICS_SYNC_WORKER_INTERVAL_MS ?? DEFAULT_CALL_METRICS_SYNC_WORKER_INTERVAL_MS);
  const rawLookback = Number(env.CALL_METRICS_SYNC_WORKER_LOOKBACK_MINUTES ?? DEFAULT_CALL_METRICS_SYNC_WORKER_LOOKBACK_MINUTES);
  const rawLimit = Number(env.CALL_METRICS_SYNC_WORKER_LIMIT ?? DEFAULT_CALL_METRICS_SYNC_WORKER_LIMIT);

  return {
    enabled,
    pollIntervalMs: clamp(
      Number.isFinite(rawInterval) ? Math.floor(rawInterval) : DEFAULT_CALL_METRICS_SYNC_WORKER_INTERVAL_MS,
      MIN_CALL_METRICS_SYNC_WORKER_INTERVAL_MS,
      MAX_CALL_METRICS_SYNC_WORKER_INTERVAL_MS,
    ),
    lookbackMinutes: clamp(
      Number.isFinite(rawLookback) ? Math.floor(rawLookback) : DEFAULT_CALL_METRICS_SYNC_WORKER_LOOKBACK_MINUTES,
      MIN_CALL_METRICS_SYNC_WORKER_LOOKBACK_MINUTES,
      MAX_CALL_METRICS_SYNC_WORKER_LOOKBACK_MINUTES,
    ),
    limit: clamp(
      Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_CALL_METRICS_SYNC_WORKER_LIMIT,
      MIN_CALL_METRICS_SYNC_WORKER_LIMIT,
      MAX_CALL_METRICS_SYNC_WORKER_LIMIT,
    ),
  };
}

export function startCallMetricsSyncWorker(env: WorkerEnv = process.env): () => void {
  const config = resolveCallMetricsSyncWorkerConfig(env);
  if (!config.enabled) {
    console.log("call-metrics-sync-worker: disabled");
    return () => {};
  }

  console.log("call-metrics-sync-worker: started", {
    pollIntervalMs: config.pollIntervalMs,
    lookbackMinutes: config.lookbackMinutes,
    limit: config.limit,
  });

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const scheduleNext = () => {
    if (stopped) return;
    timer = setTimeout(runCycle, config.pollIntervalMs);
  };

  const runCycle = async () => {
    try {
      const result = await syncRecentIncompleteCallMetrics({
        limit: config.limit,
        lookbackMinutes: config.lookbackMinutes,
      });
      if (result.ok && result.updated > 0) {
        console.log("call-metrics-sync-worker: reconciled recent calls", {
          processed: result.processed,
          updated: result.updated,
          failed: result.failed,
          total: result.total,
        });
      } else if (!result.ok) {
        console.warn("call-metrics-sync-worker: skipped cycle", { reason: result.reason });
      }
    } catch (error) {
      console.error("call-metrics-sync-worker: cycle failed", { error: String(error) });
    } finally {
      scheduleNext();
    }
  };

  scheduleNext();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
