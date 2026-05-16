export const LATE_TRANSFER_SUCCESS_MIN_SEC = Number(process.env.TRANSFER_CONNECTED_MIN_SEC ?? 10);

export function shouldPromoteLateTransferSuccess(params: {
  currentOutcome: string | null;
  postTransferDurationSec: number | null;
}) {
  if (params.currentOutcome === "transfer_success") return false;
  return (params.postTransferDurationSec ?? 0) >= LATE_TRANSFER_SUCCESS_MIN_SEC;
}
