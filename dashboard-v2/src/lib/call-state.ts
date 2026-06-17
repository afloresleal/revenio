export type DashboardOutcome =
  | 'transfer_success'
  | 'abandoned'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'voicemail';

export function hasActualTransfer(input: {
  transferredAt?: string | null;
  twilioTransferCallSid?: string | null;
  transferStatus?: string | null;
  postTransferDurationSec?: number | null;
}): boolean {
  return Boolean(
    input.transferredAt ||
    input.twilioTransferCallSid ||
    input.transferStatus ||
    ((input.postTransferDurationSec ?? 0) > 0),
  );
}

export function formatEndedReason(reason?: string | null): string {
  switch (reason) {
    case 'customer-did-not-answer':
      return 'Cliente no contestó';
    case 'voicemail':
      return 'Buzón detectado';
    case 'voicemail-beep':
      return 'Buzón detectado por beep';
    case 'no-answer':
      return 'Sin respuesta';
    default:
      return reason || 'Sin dato';
  }
}
