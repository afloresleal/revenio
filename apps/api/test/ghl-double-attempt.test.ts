import assert from "node:assert/strict";
import {
  decideGhlDoubleAttemptAction,
  deriveOutcomeFromVapiSnapshot,
  summarizeGhlDoubleAttemptVisibility,
  shouldProcessPersistedGhlSecondAttempt,
} from "../src/lib/ghl-double-attempt.js";

const retryDecision = decideGhlDoubleAttemptAction({
  outcome: "voicemail",
  resultJson: {
    ghlIntegration: {
      campaignId: "campaign-1",
      opportunityId: "opp-1",
    },
    ghlDoubleAttempt: {
      enabled: true,
      attemptNumber: 1,
      maxAttempts: 2,
      retryDelayMs: 30_000,
    },
  },
});

assert.deepEqual(retryDecision, {
  action: "schedule_retry",
  retryDelayMs: 30_000,
  nextAttemptNumber: 2,
});

assert.deepEqual(
  decideGhlDoubleAttemptAction({
    outcome: "no-answer",
    resultJson: {
      ghlIntegration: {
        campaignId: "campaign-1",
        opportunityId: "opp-1",
      },
      ghlDoubleAttempt: {
        enabled: true,
        attemptNumber: 2,
        maxAttempts: 2,
        retryDelayMs: 30_000,
      },
    },
  }),
  {
    action: "push_to_ghl",
  },
  "second recoverable failure should stop retrying and allow the normal GHL push",
);

assert.deepEqual(
  decideGhlDoubleAttemptAction({
    outcome: "transfer_success",
    resultJson: {
      ghlIntegration: {
        campaignId: "campaign-1",
        opportunityId: "opp-1",
      },
      ghlDoubleAttempt: {
        enabled: true,
        attemptNumber: 1,
        maxAttempts: 2,
        retryDelayMs: 30_000,
      },
    },
  }),
  {
    action: "push_to_ghl",
  },
  "successful transfers should go straight to GHL",
);

assert.deepEqual(
  shouldProcessPersistedGhlSecondAttempt({
    status: "pending-second-attempt",
    resultJson: {
      ghlDoubleAttempt: {
        enabled: true,
        scheduledAt: "2026-07-03T10:00:00.000Z",
      },
    },
    now: new Date("2026-07-03T10:00:30.000Z"),
  }),
  { ready: true, reason: "due" },
  "persisted retry should become executable once scheduledAt is in the past",
);

assert.deepEqual(
  shouldProcessPersistedGhlSecondAttempt({
    status: "pending-second-attempt",
    resultJson: {
      ghlDoubleAttempt: {
        enabled: true,
        scheduledAt: "2026-07-03T10:01:00.000Z",
      },
    },
    now: new Date("2026-07-03T10:00:30.000Z"),
  }),
  { ready: false, reason: "not_due_yet" },
  "persisted retry should wait until the due time",
);

assert.deepEqual(
  shouldProcessPersistedGhlSecondAttempt({
    status: "pending-second-attempt",
    resultJson: {
      ghlDoubleAttempt: {
        enabled: true,
        scheduledAt: "2026-07-03T10:00:00.000Z",
        retryAttemptId: "retry-1",
      },
    },
    now: new Date("2026-07-03T10:00:30.000Z"),
  }),
  { ready: false, reason: "already_triggered" },
  "persisted retry should not be reprocessed after a retry attempt was linked",
);

assert.deepEqual(
  summarizeGhlDoubleAttemptVisibility({
    ghlDoubleAttempt: {
      enabled: true,
      attemptNumber: 1,
      maxAttempts: 2,
      retryProcessedAt: "2026-07-03T10:00:30.000Z",
      retryAttemptId: "retry-1",
    },
  }),
  {
    enabled: true,
    attemptNumber: 1,
    maxAttempts: 2,
    isRetryAttempt: false,
    retryScheduled: false,
    retryTriggered: true,
    status: "retry_triggered",
    label: "Segundo intento realizado",
  },
  "root attempt should expose that a second call was already triggered",
);

assert.deepEqual(
  summarizeGhlDoubleAttemptVisibility({
    ghlDoubleAttempt: {
      enabled: true,
      attemptNumber: 2,
      maxAttempts: 2,
      previousAttemptId: "attempt-1",
    },
  }),
  {
    enabled: true,
    attemptNumber: 2,
    maxAttempts: 2,
    isRetryAttempt: true,
    retryScheduled: false,
    retryTriggered: false,
    status: "retry_attempt",
    label: "Segundo intento",
  },
  "retry attempt should be labeled as the second call itself",
);

assert.deepEqual(
  deriveOutcomeFromVapiSnapshot({
    status: "ended",
    endedReason: "customer-did-not-answer",
    transferredAt: null,
  }),
  {
    isEnded: true,
    outcome: "voicemail",
  },
  "ended Vapi snapshots with customer-did-not-answer should remain recoverable",
);

assert.deepEqual(
  deriveOutcomeFromVapiSnapshot({
    status: "ringing",
    endedReason: null,
    transferredAt: null,
  }),
  {
    isEnded: false,
    outcome: "in_progress",
  },
  "non-ended Vapi snapshots should stay in progress",
);

console.log("ghl-double-attempt tests passed");
