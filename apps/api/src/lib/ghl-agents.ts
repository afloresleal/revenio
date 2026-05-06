export type GhlAgentConfig = {
  name: string;
  ghlUserId: string;
  transferNumber: string;
  priority: number;
};

export type StoredGhlAgentConfig = GhlAgentConfig & {
  active?: boolean | null;
};

const MAX_ACTIVE_AGENTS = 5;

function normalizeAgent(agent: StoredGhlAgentConfig): GhlAgentConfig | null {
  const name = agent.name?.trim();
  const ghlUserId = agent.ghlUserId?.trim();
  const transferNumber = agent.transferNumber?.trim();
  if (!name || !ghlUserId || !transferNumber) return null;
  return {
    name,
    ghlUserId,
    transferNumber,
    priority: Number.isFinite(agent.priority) ? agent.priority : MAX_ACTIVE_AGENTS,
  };
}

export function mergeDbAgentsWithFallbackAgents(
  dbAgents: StoredGhlAgentConfig[],
  fallbackAgents: GhlAgentConfig[],
): GhlAgentConfig[] {
  const activeDbAgents = dbAgents
    .filter((agent) => agent.active !== false)
    .map(normalizeAgent)
    .filter((agent): agent is GhlAgentConfig => agent !== null)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_ACTIVE_AGENTS);

  if (activeDbAgents.length) return activeDbAgents;

  return fallbackAgents
    .map(normalizeAgent)
    .filter((agent): agent is GhlAgentConfig => agent !== null)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_ACTIVE_AGENTS);
}

export function orderGhlAgentsForAssignment(agents: GhlAgentConfig[], assignedTo: string): GhlAgentConfig[] {
  const assignedAgent = agents.find((agent) => agent.ghlUserId === assignedTo);
  if (!assignedAgent) return agents;
  return [
    assignedAgent,
    ...agents.filter((agent) => agent.ghlUserId !== assignedTo),
  ].slice(0, MAX_ACTIVE_AGENTS);
}
