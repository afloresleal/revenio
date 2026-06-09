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
