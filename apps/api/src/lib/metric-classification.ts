const CONNECTED_TRANSFER_STATUSES = new Set(["in-progress", "answered", "completed"]);

function diffSeconds(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return Math.round(diffMs / 1000);
}

export function normalizeMetricClassification(input: {
  outcome: string | null;
  sentiment: string | null;
  endedReason: string | null;
  transferredAt: Date | null;
  endedAt: Date | null;
  twilioTransferCallSid: string | null;
  transferStatus: string | null;
  postTransferDurationSec: number | null;
}) {
  const transferStatus = (input.transferStatus || "").toLowerCase();
  const timeAfterTransferSec = diffSeconds(input.transferredAt, input.endedAt) ?? 0;
  const hasConnectedTransfer =
    (input.postTransferDurationSec ?? 0) > 0 ||
    CONNECTED_TRANSFER_STATUSES.has(transferStatus) ||
    (!!input.transferredAt && timeAfterTransferSec > 0);

  const outcome = input.outcome ?? "completed";

  let sentiment = input.sentiment ?? "neutral";
  if (outcome === "transfer_success") sentiment = "positive";
  else if (outcome === "abandoned" || outcome === "failed") sentiment = "negative";
  else if (!sentiment || sentiment === "negative") sentiment = "neutral";

  return {
    outcome,
    sentiment,
    hasConnectedTransfer,
  };
}
