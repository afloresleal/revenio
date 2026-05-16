const FAILOVER_ANSWERED_STATUSES = new Set(["in-progress", "answered"]);
const FAILOVER_MACHINE_ANSWER_PREFIXES = ["machine", "fax"];

export function classifyTransferAnswer(params: {
  normalizedStatus: string;
  dialCallStatus: string | null;
  answeredBy: string | null;
}) {
  const answeredBy = params.answeredBy?.toLowerCase() ?? null;
  const machineAnswered = !!answeredBy && FAILOVER_MACHINE_ANSWER_PREFIXES.some((prefix) => answeredBy.startsWith(prefix));
  const hasAnsweredStatus =
    FAILOVER_ANSWERED_STATUSES.has(params.normalizedStatus) ||
    FAILOVER_ANSWERED_STATUSES.has(params.dialCallStatus ?? "");
  const humanAnswered = hasAnsweredStatus && answeredBy === "human";

  return {
    machineAnswered,
    humanAnswered,
  };
}
