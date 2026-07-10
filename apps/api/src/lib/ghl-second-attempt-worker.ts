import { processPendingGhlSecondAttempts } from "../routes/webhooks.js";

export const DEFAULT_GHL_SECOND_ATTEMPT_WORKER_INTERVAL_MS = 5_000;
const MIN_GHL_SECOND_ATTEMPT_WORKER_INTERVAL_MS = 1_000;
const MAX_GHL_SECOND_ATTEMPT_WORKER_INTERVAL_MS = 60_000;
type WorkerEnv = Record<string, string | undefined>;

type WorkerConfig = {
  enabled: boolean;
  pollIntervalMs: number;
};

function parseBoolean(value: string | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function clampInterval(value: number): number {
  return Math.max(
    MIN_GHL_SECOND_ATTEMPT_WORKER_INTERVAL_MS,
    Math.min(value, MAX_GHL_SECOND_ATTEMPT_WORKER_INTERVAL_MS),
  );
}

export function resolveGhlSecondAttemptWorkerConfig(env: WorkerEnv): WorkerConfig {
  const enabled = parseBoolean(env.GHL_SECOND_ATTEMPT_WORKER_ENABLED) ?? true;
  const rawInterval = Number(env.GHL_SECOND_ATTEMPT_WORKER_INTERVAL_MS ?? DEFAULT_GHL_SECOND_ATTEMPT_WORKER_INTERVAL_MS);
  const pollIntervalMs = clampInterval(
    Number.isFinite(rawInterval) ? Math.floor(rawInterval) : DEFAULT_GHL_SECOND_ATTEMPT_WORKER_INTERVAL_MS,
  );
  return { enabled, pollIntervalMs };
}

export function startGhlSecondAttemptWorker(env: WorkerEnv = process.env): () => void {
  const config = resolveGhlSecondAttemptWorkerConfig(env);
  if (!config.enabled) {
    console.log("ghl-second-attempt-worker: disabled");
    return () => {};
  }

  console.log("ghl-second-attempt-worker: started", {
    pollIntervalMs: config.pollIntervalMs,
  });

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const scheduleNext = () => {
    if (stopped) return;
    timer = setTimeout(runCycle, config.pollIntervalMs);
  };

  const runCycle = async () => {
    try {
      const result = await processPendingGhlSecondAttempts({ limit: 50 });
      if (result.processed > 0) {
        console.log("ghl-second-attempt-worker: processed pending retries", {
          processed: result.processed,
          skipped: result.skipped,
          total: result.total,
        });
      }
    } catch (error) {
      console.error("ghl-second-attempt-worker: cycle failed", { error: String(error) });
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
