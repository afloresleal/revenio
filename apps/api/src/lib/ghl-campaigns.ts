export type GhlCampaignConfig = {
  id?: string;
  campaignId: string;
  clientName?: string | null;
  propertyKey: string;
  name: string;
  language: string;
  vapiAssistantId: string;
  vapiPhoneNumberId: string;
  ghlLocationId?: string | null;
  ghlApiKey?: string | null;
  ghlPipelineId?: string | null;
  ghlStageId?: string | null;
  active: boolean;
};

export type StoredGhlCampaignConfig = Partial<GhlCampaignConfig> & Record<string, unknown>;

export type GhlWebhookInstructionRow = {
  key: string;
  value: string;
};

export type GhlWebhookInstructions = {
  method: "POST";
  stagingUrl: string;
  productionUrl: string;
  customDataRows: GhlWebhookInstructionRow[];
  validations: string[];
};

export type CampaignTestAgent = {
  name?: string | null;
  ghlUserId?: string | null;
  transferNumber?: string | null;
  active?: boolean | null;
  priority?: number | null;
};

export type CampaignTestFallback = {
  name?: string | null;
  ghlUserId?: string | null;
  transferNumber?: string | null;
};

export type CampaignTestTransfer = {
  name: string | null;
  ghlUserId: string | null;
  transferNumber: string;
  source: "agent" | "fallback";
};

export type CampaignCallCsvRow = {
  campaignName?: string | null;
  campaignId?: string | null;
  startedAt?: Date | string | null;
  phone?: string | null;
  outcome?: string | null;
  sentiment?: string | null;
  assignedTo?: string | null;
  firstAgentName?: string | null;
  answeredAgentName?: string | null;
  transferNumber?: string | null;
  durationSec?: number | null;
  timeToTransferSec?: number | null;
  sellerTalkSec?: number | null;
  transcript?: string | null;
  recordingUrl?: string | null;
};

export const GHL_WEBHOOK_STAGING_URL = "https://revenioapi-staging.up.railway.app/webhooks/gohighlevel";
export const GHL_WEBHOOK_PRODUCTION_URL = "https://revenioapi-production.up.railway.app/webhooks/gohighlevel";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeStoredGhlCampaign(value: StoredGhlCampaignConfig): GhlCampaignConfig | null {
  const campaignId = asString(value.campaignId);
  const propertyKey = asString(value.propertyKey);
  const name = asString(value.name);
  const language = asString(value.language) ?? "es";
  const vapiAssistantId = asString(value.vapiAssistantId);
  const vapiPhoneNumberId = asString(value.vapiPhoneNumberId);
  if (!campaignId || !propertyKey || !name || !vapiAssistantId || !vapiPhoneNumberId) return null;

  return {
    id: asString(value.id) ?? undefined,
    campaignId,
    clientName: asString(value.clientName),
    propertyKey,
    name,
    language,
    vapiAssistantId,
    vapiPhoneNumberId,
    ghlLocationId: asString(value.ghlLocationId),
    ghlApiKey: asString(value.ghlApiKey),
    ghlPipelineId: asString(value.ghlPipelineId),
    ghlStageId: asString(value.ghlStageId),
    active: value.active !== false,
  };
}

export function buildGhlWebhookInstructions(campaign: GhlCampaignConfig): GhlWebhookInstructions {
  return {
    method: "POST",
    stagingUrl: GHL_WEBHOOK_STAGING_URL,
    productionUrl: GHL_WEBHOOK_PRODUCTION_URL,
    customDataRows: [
      { key: "type", value: "OpportunityAssignedTo" },
      { key: "campaignId", value: campaign.campaignId },
      { key: "locationId", value: campaign.ghlLocationId || "GHL location ID" },
      { key: "id", value: "{{ opportunity.id }}" },
      { key: "assignedTo", value: "{{ opportunity.assigned_to }}" },
      { key: "contactId", value: "{{ contact.id }}" },
      { key: "firstName", value: "{{ contact.first_name }}" },
      { key: "lastName", value: "{{ contact.last_name }}" },
      { key: "phone", value: "{{ contact.phone }}" },
      { key: "email", value: "{{ contact.email }}" },
      { key: "pipelineId", value: campaign.ghlPipelineId || "GHL pipeline ID" },
      { key: "pipelineName", value: "GHL pipeline name" },
      { key: "stageId", value: campaign.ghlStageId || "GHL stage ID" },
      { key: "stageName", value: "GHL stage name" },
    ],
    validations: [
      "campaignId debe coincidir exactamente con la campana creada en Admin.",
      "assignedTo debe coincidir con el GHL User ID configurado en Agentes GHL.",
      "phone debe venir en formato llamable antes del demo.",
      "Usa URL staging para pruebas y URL production para cliente real.",
    ],
  };
}

export function getGhlCampaignRuntimeStatus(campaign: Pick<GhlCampaignConfig, "active">): {
  allowed: boolean;
  reason?: "campaign_inactive";
} {
  if (campaign.active === false) {
    return { allowed: false, reason: "campaign_inactive" };
  }
  return { allowed: true };
}

export function selectCampaignTestTransfer(params: {
  agents: CampaignTestAgent[];
  fallback?: CampaignTestFallback | null;
}): CampaignTestTransfer | null {
  const activeAgents = params.agents
    .filter((agent) => agent.active !== false)
    .filter((agent) => asString(agent.transferNumber))
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

  const selectedAgent = activeAgents[0];
  const selectedAgentNumber = asString(selectedAgent?.transferNumber);
  if (selectedAgent && selectedAgentNumber) {
    return {
      name: asString(selectedAgent.name),
      ghlUserId: asString(selectedAgent.ghlUserId),
      transferNumber: selectedAgentNumber,
      source: "agent",
    };
  }

  const fallbackNumber = asString(params.fallback?.transferNumber);
  if (!fallbackNumber) return null;

  return {
    name: asString(params.fallback?.name),
    ghlUserId: asString(params.fallback?.ghlUserId),
    transferNumber: fallbackNumber,
    source: "fallback",
  };
}

const CAMPAIGN_CALLS_CSV_HEADERS: Array<[keyof CampaignCallCsvRow, string]> = [
  ["campaignName", "campaign_name"],
  ["campaignId", "campaign_id"],
  ["startedAt", "started_at"],
  ["phone", "lead_phone"],
  ["outcome", "outcome"],
  ["sentiment", "sentiment"],
  ["assignedTo", "assigned_to"],
  ["firstAgentName", "first_agent"],
  ["answeredAgentName", "answered_agent"],
  ["transferNumber", "transfer_number"],
  ["durationSec", "total_duration_sec"],
  ["timeToTransferSec", "time_to_transfer_sec"],
  ["sellerTalkSec", "seller_talk_sec"],
  ["transcript", "transcript"],
  ["recordingUrl", "recording_url"],
];

function normalizeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(/\r?\n/g, " ").trim();
}

function escapeCsvValue(value: unknown): string {
  const normalized = normalizeCsvValue(value);
  if (!/[",\n\r]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}

export function buildCampaignCallsCsv(rows: CampaignCallCsvRow[]): string {
  const header = CAMPAIGN_CALLS_CSV_HEADERS.map(([, label]) => label).join(",");
  const body = rows.map((row) =>
    CAMPAIGN_CALLS_CSV_HEADERS
      .map(([key]) => escapeCsvValue(row[key]))
      .join(","),
  );
  return [header, ...body].join("\n");
}
