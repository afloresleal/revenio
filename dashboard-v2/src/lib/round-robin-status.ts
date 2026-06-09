export const formatTransferResult = (value?: string | null): string => {
  switch (value) {
    case 'child-never-answered-no-callback':
    case 'child-never-answered':
    case 'ring-timeout':
      return 'No confirmado a tiempo';
    case 'no-answer':
      return 'No contestó';
    case 'voicemail':
    case 'machine':
    case 'machine_start':
    case 'machine_end_beep':
    case 'machine_end_silence':
    case 'machine_end_other':
      return 'Buzón detectado';
    case 'busy':
      return 'Ocupado';
    case 'failed':
      return 'Falló la llamada';
    case 'human-answered':
      return 'Conectó';
    default:
      return value || 'Sin dato';
  }
};

export const formatRoundRobinAttemptStatus = (value?: string | null): string => {
  if (value === 'human-answered') return 'Contestó';
  return formatTransferResult(value);
};

type RoundRobinAttemptParams = {
  firstAgentName: string | null;
  firstAgentNumber: string | null;
  firstAgentResult: string | null;
  answeredAgentName: string | null;
  answeredAgentNumber: string | null;
  answeredAgentIndex: number | null;
  failoverSteps: Array<{
    failedName: string | null;
    failedNumber: string | null;
    result: string | null;
    nextName: string | null;
    nextNumber: string | null;
    fallback: boolean;
  }>;
};

export const buildRoundRobinAttempts = (params: RoundRobinAttemptParams) => {
  const attempts: Array<{ identity: string; result: string; answered: boolean }> = [];

  const pushAttempt = (identity: string | null, result: string | null, answered = false) => {
    if (!identity || !result) return;
    const key = `${identity}__${result}`;
    const existing = attempts.some((attempt) => `${attempt.identity}__${attempt.result}` === key);
    if (existing) return;
    attempts.push({ identity, result, answered });
  };

  const firstIdentity = params.firstAgentName ?? params.firstAgentNumber;
  const answeredIdentity = params.answeredAgentName ?? params.answeredAgentNumber;

  if (firstIdentity) {
    const inferredFirstResult =
      params.firstAgentResult ??
      (params.answeredAgentIndex !== null && params.answeredAgentIndex > 0
        ? 'child-never-answered-no-callback'
        : null);
    pushAttempt(firstIdentity, inferredFirstResult, inferredFirstResult === 'human-answered');
  }

  for (const step of params.failoverSteps) {
    const failedIdentity = step.failedName ?? step.failedNumber;
    pushAttempt(failedIdentity, step.result, step.result === 'human-answered');
  }

  if (answeredIdentity) {
    pushAttempt(answeredIdentity, 'human-answered', true);
  }

  return attempts;
};
