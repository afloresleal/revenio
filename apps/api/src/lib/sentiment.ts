/**
 * Sentiment derivation logic for voice agent calls
 * Determines call quality based on outcome, duration, and end reason
 */

export type Sentiment = 'positive' | 'neutral' | 'negative';

const SHORT_HANGUP_SEC = 10;
const VOICEMAIL_REASONS = ['no-answer', 'voicemail-beep', 'voicemail', 'customer-did-not-answer'];
const ABANDONED_REASONS = ['timeout', 'customer-busy', 'system-error'];
const NORMAL_END_REASONS = ['customer-ended-call', 'assistant-ended-call', 'completed'];

export function deriveSentiment(call: {
  outcome: string | null;
  durationSec: number | null;
  endedReason: string | null;
}): Sentiment {
  const { outcome, durationSec, endedReason } = call;

  // System errors are always negative
  if (endedReason === 'system-error') return 'negative';

  // Explicit negative outcomes
  if (outcome === 'failed' || outcome === 'abandoned') return 'negative';

  // Successful transfer is positive
  if (outcome === 'transfer_success') return 'positive';

  // Voicemail is neutral (we contacted but no human answered)
  if (outcome === 'voicemail') return 'neutral';

  // Completed calls: check duration
  if (outcome === 'completed') {
    // Very short calls = likely hung up quickly = negative
    if (durationSec !== null && durationSec < SHORT_HANGUP_SEC) return 'negative';
    return 'neutral';
  }

  // Default: neutral (in_progress or unknown)
  return 'neutral';
}

export function isAbandonedReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return ABANDONED_REASONS.includes(reason);
}

export function isNormalEndReason(reason: string | null | undefined): boolean {
  if (!reason) return true; // null = assume normal (conservative)
  return NORMAL_END_REASONS.includes(reason);
}

function isVoicemailReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return VOICEMAIL_REASONS.includes(reason);
}

export function determineOutcome(
  wasTransferred: boolean,
  endedReason: string | null
): 'transfer_success' | 'voicemail' | 'abandoned' | 'completed' {
  if (wasTransferred) return 'transfer_success';

  const isVoicemail = isVoicemailReason(endedReason);
  const isNormal = isNormalEndReason(endedReason);
  const isAbandoned = isAbandonedReason(endedReason);

  // Voicemail detection takes priority
  if (isVoicemail) return 'voicemail';

  // Explicit abandonment reasons
  if (isAbandoned) return 'abandoned';

  // Not normal end = likely abandoned
  if (!isNormal) return 'abandoned';

  // Normal end without transfer = completed
  return 'completed';
}
