export type GhlDoubleAttemptState = {
  enabled?: boolean | null;
  attemptNumber?: number | null;
  maxAttempts?: number | null;
  retryDelayMs?: number | null;
  scheduledAt?: string | null;
  retryProcessedAt?: string | null;
  retryAttemptId?: string | null;
  previousAttemptId?: string | null;
  rootAttemptId?: string | null;
};

export type GhlDoubleAttemptVisibility = {
  enabled: boolean;
  attemptNumber: number;
  maxAttempts: number;
  isRetryAttempt: boolean;
  retryScheduled: boolean;
  retryTriggered: boolean;
  status: "single_attempt" | "retry_pending" | "retry_triggered" | "retry_attempt";
  label: string | null;
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
const VOICEMAIL_REASONS = new Set(["no-answer", "voicemail-beep", "voicemail", "customer-did-not-answer"]);
const ABANDONED_REASONS = new Set(["timeout", "customer-busy", "system-error"]);
const NORMAL_END_REASONS = new Set(["customer-ended-call", "assistant-ended-call", "completed"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function deriveOutcomeFromVapiSnapshot(params: {
  status: string | null | undefined;
  endedReason: string | null | undefined;
  transferredAt: string | null | undefined;
  endedAt?: string | null | undefined;
}): { isEnded: boolean; outcome: "in_progress" | "transfer_success" | "voicemail" | "abandoned" | "completed" } {
  const status = params.status?.trim().toLowerCase() ?? null;
  const endedReason = params.endedReason?.trim() ?? null;
  const hasTransferredAt = Boolean(asString(params.transferredAt));
  const hasEndedAt = Boolean(asString(params.endedAt));
  const isEnded = status === "ended" || Boolean(endedReason || hasEndedAt);

  if (!isEnded) {
    return { isEnded: false, outcome: "in_progress" };
  }

  if (hasTransferredAt) {
    return { isEnded: true, outcome: "transfer_success" };
  }

  if (endedReason && VOICEMAIL_REASONS.has(endedReason)) {
    return { isEnded: true, outcome: "voicemail" };
  }

  if (endedReason && ABANDONED_REASONS.has(endedReason)) {
    return { isEnded: true, outcome: "abandoned" };
  }

  if (endedReason && !NORMAL_END_REASONS.has(endedReason)) {
    return { isEnded: true, outcome: "abandoned" };
  }

  return { isEnded: true, outcome: "completed" };
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

export function summarizeGhlDoubleAttemptVisibility(
  resultJson: Record<string, unknown> | null | undefined,
): GhlDoubleAttemptVisibility | null {
  const state = asRecord(resultJson?.ghlDoubleAttempt);
  if (!state) return null;

  const enabled = asBoolean(state.enabled) ?? false;
  if (!enabled) return null;

  const attemptNumber = Math.max(1, asNumber(state.attemptNumber) ?? 1);
  const maxAttempts = Math.max(1, asNumber(state.maxAttempts) ?? DEFAULT_MAX_ATTEMPTS);
  const isRetryAttempt = attemptNumber > 1 || Boolean(asString(state.previousAttemptId));
  const retryScheduled = Boolean(asString(state.scheduledAt)) && !Boolean(asString(state.retryAttemptId));
  const retryTriggered = Boolean(asString(state.retryAttemptId) || asString(state.retryProcessedAt));

  if (isRetryAttempt) {
    return {
      enabled,
      attemptNumber,
      maxAttempts,
      isRetryAttempt,
      retryScheduled,
      retryTriggered,
      status: "retry_attempt",
      label: "Segundo intento",
    };
  }

  if (retryScheduled) {
    return {
      enabled,
      attemptNumber,
      maxAttempts,
      isRetryAttempt,
      retryScheduled,
      retryTriggered,
      status: "retry_pending",
      label: "Segundo intento pendiente",
    };
  }

  if (retryTriggered) {
    return {
      enabled,
      attemptNumber,
      maxAttempts,
      isRetryAttempt,
      retryScheduled,
      retryTriggered,
      status: "retry_triggered",
      label: "Segundo intento realizado",
    };
  }

  return {
    enabled,
    attemptNumber,
    maxAttempts,
    isRetryAttempt,
    retryScheduled,
    retryTriggered,
    status: "single_attempt",
    label: null,
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
