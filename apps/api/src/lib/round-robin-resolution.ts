function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function normalizePhoneForMatch(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/[^\d]/g, "");
  return digits || null;
}

export type RoundRobinAgentMatch = {
  ghlUserId?: string | null;
  name: string | null;
  number: string;
  index: number;
};

export function findRoundRobinAgentByTransferNumber(
  resultJson: Record<string, unknown> | null,
  transferNumber: string | null,
): RoundRobinAgentMatch | null {
  if (!transferNumber) return null;
  const rr = asRecord(resultJson?.roundRobin);
  const agents = Array.isArray(rr?.agents) ? rr.agents : [];
  const normalizedTransferNumber = normalizePhoneForMatch(transferNumber);
  if (!normalizedTransferNumber) return null;

  for (const [index, agent] of agents.entries()) {
    const rec = asRecord(agent);
    const agentNumber = asString(rec?.transferNumber) ?? asString(rec?.transfer_number);
    const normalizedAgentNumber = normalizePhoneForMatch(agentNumber);
    if (agentNumber && normalizedAgentNumber === normalizedTransferNumber) {
      return {
        ghlUserId: asString(rec?.ghlUserId) ?? asString(rec?.ghl_user_id),
        name: asString(rec?.name),
        number: agentNumber,
        index,
      };
    }
  }

  return null;
}

export function hasHumanTransferEvidence(params: {
  transferStatus?: string | null;
  postTransferDurationSec?: number | null;
  transferTranscript?: string | null;
  transferRecordingUrl?: string | null;
}): boolean {
  const normalizedStatus = params.transferStatus?.toLowerCase() ?? null;
  return (
    (params.postTransferDurationSec ?? 0) > 0 ||
    !!asString(params.transferTranscript) ||
    !!asString(params.transferRecordingUrl) ||
    normalizedStatus === "completed" ||
    normalizedStatus === "in-progress"
  );
}

export function resolveRoundRobinAnsweredAgent(params: {
  resultJson: Record<string, unknown> | null;
  transferNumber: string | null;
  hasHumanConnectionEvidence: boolean;
}): (RoundRobinAgentMatch & { inferred: boolean }) | null {
  const rr = asRecord(params.resultJson?.roundRobin);
  if (rr?.enabled !== true) return null;

  const matchedFinalTransferAgent =
    params.hasHumanConnectionEvidence
      ? findRoundRobinAgentByTransferNumber(params.resultJson, params.transferNumber)
      : null;

  // Once we have human-connection evidence and the final transfer number maps to a
  // snapshot agent, that agent is the canonical answer identity.
  if (matchedFinalTransferAgent) {
    return {
      ...matchedFinalTransferAgent,
      inferred: true,
    };
  }

  const explicitName = asString(rr.answeredAgentName);
  const explicitNumber = asString(rr.answeredAgentNumber);
  const explicitIndexRaw = rr.answeredAgentIndex;
  const explicitIndex =
    typeof explicitIndexRaw === "number" && Number.isFinite(explicitIndexRaw) ? Math.trunc(explicitIndexRaw) : null;

  if (explicitName || explicitNumber || explicitIndex !== null) {
    const explicitMatchedAgent = findRoundRobinAgentByTransferNumber(
      params.resultJson,
      explicitNumber ?? params.transferNumber,
    );

    return {
      ghlUserId: explicitMatchedAgent?.ghlUserId ?? null,
      name: explicitName ?? explicitMatchedAgent?.name ?? null,
      number: explicitNumber ?? explicitMatchedAgent?.number ?? params.transferNumber ?? "",
      index: explicitIndex ?? explicitMatchedAgent?.index ?? 0,
      inferred: false,
    };
  }

  return null;
}
