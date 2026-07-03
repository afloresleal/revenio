export type GhlDoubleAttemptState = {
  enabled?: boolean | null;
  attemptNumber?: number | null;
  maxAttempts?: number | null;
  retryDelayMs?: number | null;
  scheduledAt?: string | null;
  retryProcessedAt?: string | null;
  retryAttemptId?: string | null;
};

export type GhlDoubleAttemptAction =
  | {
      action: "schedule_retry";
      retryDelayMs: number;
      nextAttemptNumber: number;
    }
  | {
      action: "push_to_ghl";
    };

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 30_000;
const RECOVERABLE_OUTCOMES = new Set(["voicemail", "no-answer"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function decideGhlDoubleAttemptAction(params: {
  outcome: string | null | undefined;
  resultJson: Record<string, unknown> | null | undefined;
}): GhlDoubleAttemptAction {
  const outcome = params.outcome ?? null;
  if (!outcome || !RECOVERABLE_OUTCOMES.has(outcome)) {
    return { action: "push_to_ghl" };
  }

  const resultJson = params.resultJson ?? null;
  const integration = asRecord(resultJson?.ghlIntegration);
  if (!integration) {
    return { action: "push_to_ghl" };
  }

  const state = asRecord(resultJson?.ghlDoubleAttempt);
  const enabled = asBoolean(state?.enabled) ?? false;
  if (!enabled) {
    return { action: "push_to_ghl" };
  }

  const attemptNumber = Math.max(1, asNumber(state?.attemptNumber) ?? 1);
  const maxAttempts = Math.max(1, asNumber(state?.maxAttempts) ?? DEFAULT_MAX_ATTEMPTS);
  const retryDelayMs = Math.max(0, asNumber(state?.retryDelayMs) ?? DEFAULT_RETRY_DELAY_MS);

  if (attemptNumber >= maxAttempts) {
    return { action: "push_to_ghl" };
  }

  return {
    action: "schedule_retry",
    retryDelayMs,
    nextAttemptNumber: attemptNumber + 1,
  };
}

export function createInitialGhlDoubleAttemptState(): Required<
  Pick<GhlDoubleAttemptState, "enabled" | "attemptNumber" | "maxAttempts" | "retryDelayMs">
> {
  return {
    enabled: true,
    attemptNumber: 1,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
  };
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function shouldProcessPersistedGhlSecondAttempt(params: {
  status: string | null | undefined;
  resultJson: Record<string, unknown> | null | undefined;
  now?: Date;
}): { ready: boolean; reason: string } {
  if (params.status !== "pending-second-attempt") {
    return { ready: false, reason: "status_not_pending" };
  }

  const state = asRecord(params.resultJson?.ghlDoubleAttempt);
  if (!state) {
    return { ready: false, reason: "missing_state" };
  }

  if ((asBoolean(state.enabled) ?? false) !== true) {
    return { ready: false, reason: "disabled" };
  }

  if (typeof state.retryAttemptId === "string" && state.retryAttemptId.trim()) {
    return { ready: false, reason: "already_triggered" };
  }

  if (typeof state.retryProcessedAt === "string" && state.retryProcessedAt.trim()) {
    return { ready: false, reason: "already_processed" };
  }

  const scheduledAt = parseDate(state.scheduledAt);
  if (!scheduledAt) {
    return { ready: false, reason: "missing_schedule" };
  }

  const now = params.now ?? new Date();
  if (scheduledAt.getTime() > now.getTime()) {
    return { ready: false, reason: "not_due_yet" };
  }

  return { ready: true, reason: "due" };
}
