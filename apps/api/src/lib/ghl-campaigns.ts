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
  ghlConnectedStageId?: string | null;
  ghlOutcomeFieldId?: string | null;
  ghlAnsweredAgentFieldId?: string | null;
  ghlFirstAgentFieldId?: string | null;
  ghlTranscriptFieldId?: string | null;
  ghlRecordingUrlFieldId?: string | null;
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

export type CampaignCallRow = {
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

export type CampaignCallExportColumn = {
  key: keyof CampaignCallRow;
  label: string;
};

export type GhlOpportunityUpdateBody = {
  assignedTo: string;
  pipelineStageId: string;
  customFields?: Array<{ id: string; field_value: string }>;
};

export type GhlPostCallCustomFieldIds = {
  outcome?: string | null;
  answeredAgent?: string | null;
  firstAgent?: string | null;
  transcript?: string | null;
  recordingUrl?: string | null;
};

export type GhlPostCallCustomFieldValues = {
  outcome?: string | null;
  answeredAgent?: string | null;
  firstAgent?: string | null;
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
    ghlConnectedStageId: asString(value.ghlConnectedStageId),
    ghlOutcomeFieldId: asString(value.ghlOutcomeFieldId),
    ghlAnsweredAgentFieldId: asString(value.ghlAnsweredAgentFieldId),
    ghlFirstAgentFieldId: asString(value.ghlFirstAgentFieldId),
    ghlTranscriptFieldId: asString(value.ghlTranscriptFieldId),
    ghlRecordingUrlFieldId: asString(value.ghlRecordingUrlFieldId),
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

export function buildGhlOpportunityUpdateBody(params: {
  assignedTo: string;
  connectedStageId: string;
  customFieldIds?: GhlPostCallCustomFieldIds | null;
  customFieldValues?: GhlPostCallCustomFieldValues | null;
}): GhlOpportunityUpdateBody {
  const body: GhlOpportunityUpdateBody = {
    assignedTo: params.assignedTo,
    pipelineStageId: params.connectedStageId,
  };
  const ids = params.customFieldIds;
  const values = params.customFieldValues;
  if (ids && values) {
    const customFields = [
      [ids.outcome, values.outcome],
      [ids.answeredAgent, values.answeredAgent],
      [ids.firstAgent, values.firstAgent],
      [ids.transcript, values.transcript],
      [ids.recordingUrl, values.recordingUrl],
    ]
      .flatMap(([id, value]) => {
        const fieldId = asString(id);
        return fieldId ? [{ id: fieldId, field_value: String(value ?? "") }] : [];
      });
    if (customFields.length) body.customFields = customFields;
  }
  return body;
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

export const CAMPAIGN_CALL_EXPORT_COLUMNS: CampaignCallExportColumn[] = [
  { key: "campaignName", label: "campaign_name" },
  { key: "campaignId", label: "campaign_id" },
  { key: "startedAt", label: "started_at" },
  { key: "phone", label: "lead_phone" },
  { key: "outcome", label: "outcome" },
  { key: "sentiment", label: "sentiment" },
  { key: "assignedTo", label: "assigned_to" },
  { key: "firstAgentName", label: "first_agent" },
  { key: "answeredAgentName", label: "answered_agent" },
  { key: "transferNumber", label: "transfer_number" },
  { key: "durationSec", label: "total_duration_sec" },
  { key: "timeToTransferSec", label: "time_to_transfer_sec" },
  { key: "sellerTalkSec", label: "seller_talk_sec" },
  { key: "transcript", label: "transcript" },
  { key: "recordingUrl", label: "recording_url" },
];

const CAMPAIGN_CALLS_CSV_TIMEZONE = "America/Mexico_City";

function normalizeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(/\r?\n/g, " ").trim();
}

function normalizeCsvDateTime(value: CampaignCallRow["startedAt"]): string {
  if (value === null || value === undefined) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return normalizeCsvValue(value);
  return date.toLocaleString("es-MX", {
    timeZone: CAMPAIGN_CALLS_CSV_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function escapeCsvValue(value: unknown): string {
  const normalized = normalizeCsvValue(value);
  if (!/[",\n\r]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}

export function buildCampaignCallExportRows(rows: CampaignCallRow[]): Array<Record<string, string>> {
  return rows.map((row) => {
    const normalized: Record<string, string> = {};
    CAMPAIGN_CALL_EXPORT_COLUMNS.forEach(({ key }) => {
      normalized[key] = key === "startedAt" ? normalizeCsvDateTime(row[key]) : normalizeCsvValue(row[key]);
    });
    return normalized;
  });
}

export function buildCampaignCallsCsv(rows: CampaignCallRow[]): string {
  const header = CAMPAIGN_CALL_EXPORT_COLUMNS.map(({ label }) => label).join(",");
  const exportRows = buildCampaignCallExportRows(rows);
  const body = exportRows.map((row) =>
    CAMPAIGN_CALL_EXPORT_COLUMNS
      .map(({ key }) => escapeCsvValue(row[key] ?? ""))
      .join(","),
  );
  return [header, ...body].join("\n");
}
