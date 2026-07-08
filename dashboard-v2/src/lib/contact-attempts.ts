export type ContactAttemptRow = {
  attemptId?: string | null;
  callId: string;
  ghlRootAttemptId?: string | null;
  leadName?: string | null;
  phone: string;
  campaignName?: string | null;
  assistantId?: string | null;
  transferNumber?: string | null;
  outcome: string;
  duration: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  ago: string;
  inProgress?: boolean;
  ghlRetryStatus?: string | null;
  ghlRetryLabel?: string | null;
  ghlIsRetryAttempt?: boolean;
  ghlRetryTriggered?: boolean;
  [key: string]: unknown;
};

export type ContactAttemptTimeline = Array<{
  label: string;
  outcome: string | null;
  callId: string;
}>;

export function buildFlowLabel(primary: ContactAttemptRow, retry?: ContactAttemptRow | null): string {
  if (retry) {
    if (retry.outcome === 'transfer_success' || retry.outcome === 'completed') return 'Segunda llamada completada';
    if (retry.outcome === 'voicemail' || retry.outcome === 'abandoned' || retry.outcome === 'failed') return 'Segunda llamada sin exito';
    return 'Segunda llamada en curso';
  }
  if (primary.ghlRetryStatus === 'retry_pending') return 'Segunda llamada pendiente';
  if (primary.ghlRetryTriggered) return 'Segunda llamada en curso';
  return 'Sin segunda llamada';
}

export function consolidateContactAttempts<T extends ContactAttemptRow>(
  calls: T[],
): Array<T & { ghlFlowLabel: string; ghlAttemptTimeline: ContactAttemptTimeline }> {
  const groups = new Map<string, { primary: T; retry: T | null }>();

  calls.forEach((call) => {
    const groupKey = call.ghlRootAttemptId ?? call.attemptId ?? call.callId;
    const current = groups.get(groupKey);
    if (!current) {
      groups.set(groupKey, { primary: call, retry: call.ghlIsRetryAttempt ? call : null });
      return;
    }

    if (call.ghlIsRetryAttempt) {
      current.retry = call;
      return;
    }

    current.primary = call;
  });

  return Array.from(groups.values())
    .map(({ primary, retry }) => {
      const timeline: ContactAttemptTimeline = [
        {
          label: 'Intento 1',
          outcome: primary.outcome,
          callId: primary.callId,
        },
      ];

      if (retry) {
        timeline.push({
          label: 'Intento 2',
          outcome: retry.outcome,
          callId: retry.callId,
        });
      }

      const base = retry ?? primary;
      return {
        ...base,
        ghlFlowLabel: buildFlowLabel(primary, retry),
        ghlAttemptTimeline: timeline,
        ghlRetryLabel: retry ? buildFlowLabel(primary, retry) : primary.ghlRetryLabel,
        ghlIsRetryAttempt: false,
      };
    })
    .sort((a, b) => {
      const left = new Date(a.startedAt ?? a.endedAt ?? 0).getTime();
      const right = new Date(b.startedAt ?? b.endedAt ?? 0).getTime();
      return right - left;
    });
}
