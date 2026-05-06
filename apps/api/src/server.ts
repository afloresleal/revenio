import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import {
  canRunRoundRobinFailover,
  canStartOutboundCall,
  getCallWindowSettings,
  resetCallWindowSettings,
  updateCallWindowSettings,
} from "./lib/call-window.js";

// Import route modules
import metricsRouter from "./routes/metrics.js";
import webhooksRouter from "./routes/webhooks.js";
import jobsRouter from "./routes/jobs.js";
import {
  buildCampaignCallsCsv,
  buildGhlWebhookInstructions,
  normalizeStoredGhlCampaign,
  selectCampaignTestTransfer,
} from "./lib/ghl-campaigns.js";

const prisma = new PrismaClient();
const app = express();
const FAILOVER_RING_TIMEOUT_SEC = Math.max(1, Number(process.env.TRANSFER_FAILOVER_RING_TIMEOUT_SEC ?? 15));
function resolvePublicApiBaseUrl(): string {
  const explicit = (process.env.PUBLIC_API_BASE_URL || process.env.API_BASE_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const railwayDomain = (process.env.RAILWAY_PUBLIC_DOMAIN || "").trim();
  if (railwayDomain) return `https://${railwayDomain}`.replace(/\/+$/, "");
  return "https://revenioapi-production.up.railway.app";
}
const PUBLIC_API_BASE_URL = resolvePublicApiBaseUrl();
const FAILOVER_FAILURE_STATUSES = new Set(["no-answer", "busy", "failed", "canceled"]);
const FAILOVER_ANSWERED_STATUSES = new Set(["in-progress", "answered"]);
const FAILOVER_MACHINE_ANSWER_PREFIXES = ["machine", "fax"];
const FAILOVER_CLEAR_TIMER_STATUSES = new Set([
  "in-progress",
  "completed",
  "no-answer",
  "busy",
  "failed",
  "canceled",
]);
const failoverTimers = new Map<string, NodeJS.Timeout>();

type AgentFailoverReason = "ring-timeout" | "no-answer" | "busy" | "failed" | "voicemail";

// CORS configuration for dashboard
app.use(cors({
  origin: [
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:5175',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5175',
    'https://revenio.austack.app',
    // Railway domains
    'https://revenioapi-production.up.railway.app',
    'https://revenio-lab-production.up.railway.app',
    /\.up\.railway\.app$/,  // Any Railway subdomain
    process.env.DASHBOARD_URL,
  ].filter(Boolean) as (string | RegExp)[],
  credentials: true,
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Mount route modules
app.use('/api/metrics', metricsRouter);
app.use('/api/jobs', jobsRouter);
app.use('/webhooks', webhooksRouter);

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "revenio-api",
    endpoints: {
      health: "/health",
      lab: "/lab",
      metrics: "/api/metrics",
      webhooks: "/webhooks",
    },
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "revenio-api" });
});

const leadSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(6),
  source: z.string().min(1).optional(),
});

app.post("/lead", async (req, res) => {
  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  }

  const { name, phone, source } = parsed.data;

  const lead = await prisma.lead.create({
    data: {
      name,
      phone,
      source,
      events: {
        create: {
          type: "lead_received",
          detail: { source: source ?? null },
        },
      },
    },
  });

  console.log("lead_received", { leadId: lead.id, phone: lead.phone });

  return res.status(201).json({ lead_id: lead.id, status: lead.status });
});

app.get("/lead/:id", async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: { attempts: true, events: true },
  });
  if (!lead) {
    return res.status(404).json({ error: "not_found" });
  }
  return res.json(lead);
});

const leadListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["NEW", "CALL_SCHEDULED", "CALL_IN_PROGRESS", "CALL_COMPLETED", "NO_ANSWER", "FAILED"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  hasAttempts: z.coerce.boolean().optional(),
});
type LeadListQuery = z.infer<typeof leadListSchema>;

app.get("/leads", async (req, res) => {
  const parsed = leadListSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", issues: parsed.error.issues });
  }

  const { page, pageSize, status, from, to, hasAttempts }: LeadListQuery = parsed.data;
  const fromDate = from ? new Date(from) : undefined;
  if (from && Number.isNaN(fromDate?.getTime())) {
    return res.status(400).json({ error: "invalid_query", field: "from" });
  }
  const toDate = to ? new Date(to) : undefined;
  if (to && Number.isNaN(toDate?.getTime())) {
    return res.status(400).json({ error: "invalid_query", field: "to" });
  }

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (fromDate || toDate) {
    where.createdAt = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    };
  }
  if (hasAttempts === true) where.attempts = { some: {} };
  if (hasAttempts === false) where.attempts = { none: {} };

  const [total, leads] = await prisma.$transaction([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { attempts: true } } },
    }),
  ]);

  return res.json({
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    data: leads,
  });
});

function getMetadataCandidates(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const call = p.call as Record<string, unknown> | undefined;
  const msg = p.message as Record<string, unknown> | undefined;
  const msgCall = msg?.call as Record<string, unknown> | undefined;
  const assistantOverrides = p.assistantOverrides as Record<string, unknown> | undefined;
  const callAssistantOverrides = call?.assistantOverrides as Record<string, unknown> | undefined;
  const msgAssistantOverrides = msg?.assistantOverrides as Record<string, unknown> | undefined;
  const msgCallAssistantOverrides = msgCall?.assistantOverrides as Record<string, unknown> | undefined;

  const candidates: Array<Record<string, unknown> | undefined> = [
    p.metadata as Record<string, unknown> | undefined,
    assistantOverrides?.metadata as Record<string, unknown> | undefined,
    call?.metadata as Record<string, unknown> | undefined,
    callAssistantOverrides?.metadata as Record<string, unknown> | undefined,
    msg?.metadata as Record<string, unknown> | undefined,
    msgAssistantOverrides?.metadata as Record<string, unknown> | undefined,
    msgCall?.metadata as Record<string, unknown> | undefined,
    msgCallAssistantOverrides?.metadata as Record<string, unknown> | undefined,
  ];

  return candidates.filter((c): c is Record<string, unknown> => !!c && typeof c === "object");
}

function extractLeadId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.lead_id === "string") return p.lead_id;
  if (typeof p.leadId === "string") return p.leadId;
  if (typeof p.leadId === "number") return String(p.leadId);
  const metas = getMetadataCandidates(payload);
  for (const meta of metas) {
    if (typeof meta.lead_id === "string") return meta.lead_id;
    if (typeof meta.leadId === "string") return meta.leadId;
    if (typeof meta.leadId === "number") return String(meta.leadId);
  }
  return null;
}

function extractAttemptId(payload: unknown): string | null {
  const metas = getMetadataCandidates(payload);
  for (const meta of metas) {
    if (typeof meta.attempt_id === "string") return meta.attempt_id;
    if (typeof meta.attemptId === "string") return meta.attemptId;
    if (typeof meta.attemptId === "number") return String(meta.attemptId);
  }
  return null;
}

function extractVapiCallId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const call = p.call as Record<string, unknown> | undefined;
  const msg = p.message as Record<string, unknown> | undefined;
  const msgCall = msg?.call as Record<string, unknown> | undefined;

  const candidates = [p.id, call?.id, msg?.id, msgCall?.id];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function buildTranscriptFromMessages(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  const lines = messages
    .map((m) => {
      if (!m || typeof m !== "object") return null;
      const msg = m as Record<string, unknown>;
      const role = typeof msg.role === "string" ? msg.role : null;
      const text = typeof msg.message === "string" ? msg.message : null;
      if (!text) return null;
      if (!role) return text;
      if (role === "assistant") return `AI: ${text}`;
      if (role === "user") return `User: ${text}`;
      return `${role}: ${text}`;
    })
    .filter((x): x is string => !!x);
  return lines.length ? lines.join("\n") : null;
}

function extractTranscriptFromVapiPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  const explicitTranscriptCandidates: unknown[] = [
    p.transcript,
    (p.message as Record<string, unknown> | undefined)?.transcript,
    (p.artifact as Record<string, unknown> | undefined)?.transcript,
    ((p.message as Record<string, unknown> | undefined)?.artifact as Record<string, unknown> | undefined)?.transcript,
    ((p.call as Record<string, unknown> | undefined)?.artifact as Record<string, unknown> | undefined)?.transcript,
  ];

  for (const candidate of explicitTranscriptCandidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }

  const messageCandidates: unknown[] = [
    p.messages,
    (p.message as Record<string, unknown> | undefined)?.messages,
    (p.artifact as Record<string, unknown> | undefined)?.messages,
    ((p.message as Record<string, unknown> | undefined)?.artifact as Record<string, unknown> | undefined)?.messages,
    (p.call as Record<string, unknown> | undefined)?.messages,
  ];

  for (const candidate of messageCandidates) {
    const built = buildTranscriptFromMessages(candidate);
    if (built) return built;
  }

  return null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function composeFullTranscript(aiTranscript: string | null | undefined, transferTranscript: string | null | undefined): string | null {
  const ai = typeof aiTranscript === "string" && aiTranscript.trim() ? aiTranscript.trim() : null;
  const transfer = typeof transferTranscript === "string" && transferTranscript.trim() ? transferTranscript.trim() : null;
  if (!ai && !transfer) return null;
  if (ai && !transfer) return ai;
  if (!ai && transfer) return `Transfer (humano): ${transfer}`;
  return `${ai}\n\nTransfer (humano): ${transfer}`;
}

function mergeRecordingsJson(
  existing: unknown,
  patch: {
    vapiUrl?: string | null;
    twilioTransferUrl?: string | null;
    twilioTransferDurationSec?: number | null;
    twilioTransferCallSid?: string | null;
    twilioRecordingSid?: string | null;
    twilioRecordingStatus?: string | null;
  },
) {
  const prev = existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
  const next = { ...prev } as Record<string, unknown>;
  if (patch.vapiUrl) {
    next.vapi = { ...(prev.vapi as Record<string, unknown> | undefined), url: patch.vapiUrl };
  }
  if (patch.twilioTransferUrl || patch.twilioTransferDurationSec !== null || patch.twilioTransferCallSid || patch.twilioRecordingSid || patch.twilioRecordingStatus) {
    next.twilioTransfer = {
      ...(prev.twilioTransfer as Record<string, unknown> | undefined),
      ...(patch.twilioTransferUrl ? { url: patch.twilioTransferUrl } : {}),
      ...(patch.twilioTransferDurationSec !== null && patch.twilioTransferDurationSec !== undefined
        ? { durationSec: patch.twilioTransferDurationSec }
        : {}),
      ...(patch.twilioTransferCallSid ? { callSid: patch.twilioTransferCallSid } : {}),
      ...(patch.twilioRecordingSid ? { recordingSid: patch.twilioRecordingSid } : {}),
      ...(patch.twilioRecordingStatus ? { status: patch.twilioRecordingStatus } : {}),
    };
  }
  return next;
}

async function resolveTwilioContext(payload: unknown, query: Record<string, unknown>) {
  const body = (payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}) as Record<string, unknown>;
  const callSid = asNonEmptyString(body.CallSid);
  const parentCallSid = asNonEmptyString(body.ParentCallSid);
  const parentSid = parentCallSid ?? callSid;
  const explicitVapiCallId =
    asNonEmptyString(body.vapi_call_id) ??
    asNonEmptyString(query.call_id) ??
    asNonEmptyString(query.vapi_call_id);

  let leadId =
    extractLeadId(payload) ??
    (typeof query.lead_id === "string" ? query.lead_id : null);
  let attemptId =
    extractAttemptId(payload) ??
    (typeof query.attempt_id === "string" ? query.attempt_id : null);
  let attempt =
    attemptId
      ? await prisma.callAttempt.findUnique({ where: { id: attemptId } })
      : null;

  if (!attempt && explicitVapiCallId) {
    attempt = await prisma.callAttempt.findFirst({
      where: { providerId: explicitVapiCallId },
      orderBy: { createdAt: "desc" },
    });
  }

  let link =
    parentSid
      ? await prisma.twilioCallLink.findUnique({ where: { parentCallSid: parentSid } })
      : null;
  if (!link && callSid) {
    link = await prisma.twilioCallLink.findFirst({
      where: { childCallSid: callSid },
      orderBy: { updatedAt: "desc" },
    });
  }

  if (!attempt && link?.attemptId) {
    attempt = await prisma.callAttempt.findUnique({ where: { id: link.attemptId } });
  }

  if (!attempt && callSid) {
    attempt = await prisma.callAttempt.findFirst({
      where: { providerId: callSid },
      orderBy: { createdAt: "desc" },
    });
  }

  if (!attempt && leadId) {
    attempt = await prisma.callAttempt.findFirst({
      where: { leadId },
      orderBy: { createdAt: "desc" },
    });
  }

  const vapiCallId = explicitVapiCallId ?? attempt?.providerId ?? link?.vapiCallId ?? null;
  leadId = leadId ?? attempt?.leadId ?? link?.leadId ?? null;
  attemptId = attempt?.id ?? attemptId ?? link?.attemptId ?? null;

  return {
    callSid,
    parentCallSid,
    parentSid,
    attempt,
    attemptId,
    leadId,
    vapiCallId,
    link,
  };
}

async function upsertTwilioLink(params: {
  parentSid: string;
  vapiCallId: string;
  attemptId?: string | null;
  leadId?: string | null;
  childCallSid?: string | null;
  childStatus?: string | null;
}) {
  await prisma.twilioCallLink.upsert({
    where: { parentCallSid: params.parentSid },
    create: {
      parentCallSid: params.parentSid,
      vapiCallId: params.vapiCallId,
      attemptId: params.attemptId ?? null,
      leadId: params.leadId ?? null,
      childCallSid: params.childCallSid ?? null,
      childStatus: params.childStatus ?? null,
      lastCallbackAt: new Date(),
    },
    update: {
      vapiCallId: params.vapiCallId,
      attemptId: params.attemptId ?? undefined,
      leadId: params.leadId ?? undefined,
      childCallSid: params.childCallSid ?? undefined,
      childStatus: params.childStatus ?? undefined,
      lastCallbackAt: new Date(),
    },
  });
}

function clearFailoverTimer(timerKey: string) {
  const timer = failoverTimers.get(timerKey);
  if (!timer) return;
  clearTimeout(timer);
  failoverTimers.delete(timerKey);
}

function asFiniteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function isMachineAnswered(answeredBy: string | null): boolean {
  if (!answeredBy) return false;
  return FAILOVER_MACHINE_ANSWER_PREFIXES.some((prefix) => answeredBy.startsWith(prefix));
}

function mapStatusToFailoverReason(status: string | null): Exclude<AgentFailoverReason, "ring-timeout" | "voicemail"> | null {
  if (!status) return null;
  if (status === "no-answer") return "no-answer";
  if (status === "busy") return "busy";
  if (status === "failed" || status === "canceled") return "failed";
  return null;
}

function buildFirstAgentOutcomePatch(params: {
  rr: Record<string, unknown>;
  currentIndex: number;
  currentAgent: { name: string | null; transferNumber: string } | null;
  result: string;
}) {
  if (params.currentIndex !== 0) return {};
  if (asNonEmptyString(params.rr.firstAgentResult)) return {};
  return {
    firstAgentIndex: 0,
    firstAgentName: params.currentAgent?.name ?? null,
    firstAgentNumber: params.currentAgent?.transferNumber ?? null,
    firstAgentResult: params.result,
    firstAgentOutcomeAt: new Date().toISOString(),
  };
}

function extractTwilioParentSidFromVapiResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const transport = root.phoneCallTransport && typeof root.phoneCallTransport === "object"
    ? (root.phoneCallTransport as Record<string, unknown>)
    : null;
  const candidates: unknown[] = [
    root.phoneCallProviderId,
    root.providerCallSid,
    root.callSid,
    transport?.providerCallSid,
    transport?.callSid,
    transport?.sid,
  ];
  for (const value of candidates) {
    const sid = asNonEmptyString(value);
    if (sid && sid.startsWith("CA")) return sid;
  }
  return null;
}

async function linkAttemptWithTwilioParentSid(params: {
  vapiCallId: string | null;
  attemptId: string;
  leadId: string;
  vapiResponse: unknown;
}) {
  if (!params.vapiCallId) return;
  const parentSid = extractTwilioParentSidFromVapiResponse(params.vapiResponse);
  if (!parentSid) return;
  await upsertTwilioLink({
    parentSid,
    vapiCallId: params.vapiCallId,
    attemptId: params.attemptId,
    leadId: params.leadId,
  });
  console.log("twilio_link_seeded", {
    parentSid,
    vapiCallId: params.vapiCallId,
    attemptId: params.attemptId,
  });
}

function parseRoundRobinAgentsFromResultJson(resultJson: unknown): Array<{ name: string | null; transferNumber: string }> {
  if (!resultJson || typeof resultJson !== "object") return [];
  const root = resultJson as Record<string, unknown>;
  const rr = root.roundRobin;
  if (!rr || typeof rr !== "object") return [];
  const rrObj = rr as Record<string, unknown>;
  if (!Array.isArray(rrObj.agents)) return [];
  return rrObj.agents
    .map((agent) => (agent && typeof agent === "object" ? (agent as Record<string, unknown>) : null))
    .filter((agent): agent is Record<string, unknown> => !!agent)
    .map((agent) => ({
      name: asNonEmptyString(agent.name) ?? null,
      transferNumber: asNonEmptyString(agent.transferNumber) ?? asNonEmptyString(agent.transfer_number) ?? "",
    }))
    .filter((agent) => !!agent.transferNumber);
}

function normalizePhoneForMatch(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const keepPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;
  return keepPlus ? `+${digits}` : digits;
}

function extractSelectedTransferNumberFromResultJson(resultJson: unknown): string | null {
  if (!resultJson || typeof resultJson !== "object") return null;
  const root = resultJson as Record<string, unknown>;
  const rr = root.roundRobin && typeof root.roundRobin === "object"
    ? (root.roundRobin as Record<string, unknown>)
    : null;
  return (
    asNonEmptyString(root.transferNumber) ??
    asNonEmptyString(root.transfer_number) ??
    asNonEmptyString(rr?.selectedTransferNumber) ??
    null
  );
}

function extractFallbackTransferNumberFromResultJson(resultJson: unknown): string | null {
  if (!resultJson || typeof resultJson !== "object") return null;
  const root = resultJson as Record<string, unknown>;
  const rr = root.roundRobin && typeof root.roundRobin === "object"
    ? (root.roundRobin as Record<string, unknown>)
    : null;
  return (
    asNonEmptyString(root.fallbackTransferNumber) ??
    asNonEmptyString(root.fallback_transfer_number) ??
    asNonEmptyString(rr?.fallbackTransferNumber) ??
    asNonEmptyString(rr?.fallback_transfer_number) ??
    null
  );
}

function shouldUseFallbackTransfer(
  rr: Record<string, unknown>,
  fallbackTransferNumber: string | null,
): fallbackTransferNumber is string {
  return !!fallbackTransferNumber && rr.fallbackTransferAttempted !== true;
}

async function executeFailoverToNextAgent(params: {
  attemptId: string;
  leadId?: string | null;
  currentChildCallSid?: string | null;
  reason: AgentFailoverReason;
}) {
  const rrWindow = canRunRoundRobinFailover();
  if (!rrWindow.allowed) {
    return {
      ok: false,
      reason: "outside_business_hours" as const,
      policy: rrWindow,
    };
  }

  const attempt = await prisma.callAttempt.findUnique({
    where: { id: params.attemptId },
    select: {
      id: true,
      leadId: true,
      providerId: true,
      controlUrl: true,
      resultJson: true,
    },
  });
  if (!attempt?.controlUrl) return { ok: false, reason: "missing_control_url" as const };

  const result = attempt.resultJson && typeof attempt.resultJson === "object"
    ? (attempt.resultJson as Record<string, unknown>)
    : {};
  const rr = result.roundRobin && typeof result.roundRobin === "object"
    ? (result.roundRobin as Record<string, unknown>)
    : null;
  if (!rr || rr.enabled !== true) return { ok: false, reason: "round_robin_disabled" as const };

  const agents = parseRoundRobinAgentsFromResultJson(result);
  if (agents.length === 0) return { ok: false, reason: "insufficient_pool" as const };

  const currentIndex = asFiniteInteger(rr.selectedAgentIndex) ?? 0;
  const currentAgent = agents[currentIndex] ?? null;
  const nextIndex = currentIndex + 1;
  if (nextIndex >= agents.length) {
    const fallbackTransferNumber = extractFallbackTransferNumberFromResultJson(result);
    if (shouldUseFallbackTransfer(rr, fallbackTransferNumber)) {
      const transferResp = await fetch(attempt.controlUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "transfer",
          destination: { type: "number", number: fallbackTransferNumber },
        }),
      });
      if (!transferResp.ok) {
        return { ok: false, reason: "fallback_transfer_command_failed" as const, status: transferResp.status };
      }

      const nextRoundRobin = {
        ...rr,
        selectedAgentIndex: agents.length,
        selectedAgentName: null,
        selectedTransferNumber: fallbackTransferNumber,
        fallbackTransferNumber,
        fallbackTransferAttempted: true,
        fallbackTransferAttemptedAt: new Date().toISOString(),
        lastEscalatedFromCallSid: params.currentChildCallSid ?? rr.lastEscalatedFromCallSid,
        lastFailoverReason: params.reason,
        lastEscalatedAt: new Date().toISOString(),
        lastFailedAgentIndex: currentIndex,
        lastFailedAgentName: currentAgent?.name ?? null,
        lastFailedAgentNumber: currentAgent?.transferNumber ?? null,
        lastFailedAgentResult: params.reason,
        ...buildFirstAgentOutcomePatch({
          rr,
          currentIndex,
          currentAgent,
          result: params.reason,
        }),
      };

      await prisma.callAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "auto-transferred-fallback",
          resultJson: {
            ...result,
            transferNumber: fallbackTransferNumber,
            fallbackTransferNumber,
            roundRobin: nextRoundRobin,
          } as any,
        },
      });

      if (params.leadId ?? attempt.leadId) {
        await prisma.event.create({
          data: {
            leadId: (params.leadId ?? attempt.leadId)!,
            type: "transfer_fallback",
            detail: {
              attemptId: attempt.id,
              callId: attempt.providerId,
              reason: params.reason,
              currentChildCallSid: params.currentChildCallSid ?? null,
              failedAgentIndex: currentIndex,
              failedAgentName: currentAgent?.name ?? null,
              failedAgentNumber: currentAgent?.transferNumber ?? null,
              failedAgentResult: params.reason,
              nextIndex: agents.length,
              nextTransferNumber: fallbackTransferNumber,
              nextAgentName: null,
              fallback: true,
            } as any,
          },
        });
      }

      return {
        ok: true,
        failedAgentIndex: currentIndex,
        failedAgentName: currentAgent?.name ?? null,
        failedAgentNumber: currentAgent?.transferNumber ?? null,
        failedAgentResult: params.reason,
        nextIndex: agents.length,
        nextTransferNumber: fallbackTransferNumber,
        nextAgentName: null,
        fallback: true,
      };
    }

    await prisma.callAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "transfer-failover-exhausted",
        resultJson: {
          ...result,
          roundRobin: {
            ...rr,
            exhausted: true,
            exhaustedAt: new Date().toISOString(),
            lastFailoverReason: params.reason,
            lastEscalatedFromCallSid: params.currentChildCallSid ?? rr.lastEscalatedFromCallSid,
            lastFailedAgentIndex: currentIndex,
            lastFailedAgentName: currentAgent?.name ?? null,
            lastFailedAgentNumber: currentAgent?.transferNumber ?? null,
            lastFailedAgentResult: params.reason,
            ...buildFirstAgentOutcomePatch({
              rr,
              currentIndex,
              currentAgent,
              result: params.reason,
            }),
          },
        } as any,
      },
    });
    return { ok: false, reason: "pool_exhausted" as const };
  }

  const lastEscalatedFromCallSid = asNonEmptyString(rr.lastEscalatedFromCallSid);
  if (params.currentChildCallSid && lastEscalatedFromCallSid === params.currentChildCallSid) {
    return { ok: false, reason: "duplicate_escalation" as const };
  }

  const nextAgent = agents[nextIndex];
  const transferResp = await fetch(attempt.controlUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "transfer",
      destination: { type: "number", number: nextAgent.transferNumber },
    }),
  });
  if (!transferResp.ok) {
    return { ok: false, reason: "transfer_command_failed" as const, status: transferResp.status };
  }

  const nextRoundRobin = {
    ...rr,
    selectedAgentIndex: nextIndex,
    selectedAgentName: nextAgent.name,
    selectedTransferNumber: nextAgent.transferNumber,
    lastEscalatedFromCallSid: params.currentChildCallSid ?? rr.lastEscalatedFromCallSid,
    lastFailoverReason: params.reason,
    lastEscalatedAt: new Date().toISOString(),
    lastFailedAgentIndex: currentIndex,
    lastFailedAgentName: currentAgent?.name ?? null,
    lastFailedAgentNumber: currentAgent?.transferNumber ?? null,
    lastFailedAgentResult: params.reason,
    ...buildFirstAgentOutcomePatch({
      rr,
      currentIndex,
      currentAgent,
      result: params.reason,
    }),
  };

  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "auto-transferred-failover",
      resultJson: {
        ...result,
        transferNumber: nextAgent.transferNumber,
        roundRobin: nextRoundRobin,
      } as any,
    },
  });

  if (params.leadId ?? attempt.leadId) {
    await prisma.event.create({
      data: {
        leadId: (params.leadId ?? attempt.leadId)!,
        type: "transfer_failover",
        detail: {
          attemptId: attempt.id,
          callId: attempt.providerId,
          reason: params.reason,
          currentChildCallSid: params.currentChildCallSid ?? null,
          failedAgentIndex: currentIndex,
          failedAgentName: currentAgent?.name ?? null,
          failedAgentNumber: currentAgent?.transferNumber ?? null,
          failedAgentResult: params.reason,
          nextIndex,
          nextTransferNumber: nextAgent.transferNumber,
          nextAgentName: nextAgent.name,
        } as any,
      },
    });
  }

  return {
    ok: true,
    failedAgentIndex: currentIndex,
    failedAgentName: currentAgent?.name ?? null,
    failedAgentNumber: currentAgent?.transferNumber ?? null,
    failedAgentResult: params.reason,
    nextIndex,
    nextTransferNumber: nextAgent.transferNumber,
    nextAgentName: nextAgent.name,
  };
}

async function selectNextRoundRobinAgent(params: {
  attemptId: string;
  leadId?: string | null;
  currentChildCallSid?: string | null;
  reason: AgentFailoverReason;
}) {
  const rrWindow = canRunRoundRobinFailover();
  if (!rrWindow.allowed) {
    return {
      ok: false,
      reason: "outside_business_hours" as const,
      policy: rrWindow,
    };
  }

  const attempt = await prisma.callAttempt.findUnique({
    where: { id: params.attemptId },
    select: {
      id: true,
      leadId: true,
      providerId: true,
      resultJson: true,
    },
  });
  if (!attempt) return { ok: false, reason: "attempt_not_found" as const };

  const result = attempt.resultJson && typeof attempt.resultJson === "object"
    ? (attempt.resultJson as Record<string, unknown>)
    : {};
  const rr = result.roundRobin && typeof result.roundRobin === "object"
    ? (result.roundRobin as Record<string, unknown>)
    : null;
  if (!rr || rr.enabled !== true) return { ok: false, reason: "round_robin_disabled" as const };

  const agents = parseRoundRobinAgentsFromResultJson(result);
  if (agents.length === 0) return { ok: false, reason: "insufficient_pool" as const };

  const currentIndex = asFiniteInteger(rr.selectedAgentIndex) ?? 0;
  const currentAgent = agents[currentIndex] ?? null;
  const nextIndex = currentIndex + 1;
  if (nextIndex >= agents.length) {
    const fallbackTransferNumber = extractFallbackTransferNumberFromResultJson(result);
    if (shouldUseFallbackTransfer(rr, fallbackTransferNumber)) {
      const nextRoundRobin = {
        ...rr,
        selectedAgentIndex: agents.length,
        selectedAgentName: null,
        selectedTransferNumber: fallbackTransferNumber,
        fallbackTransferNumber,
        fallbackTransferAttempted: true,
        fallbackTransferAttemptedAt: new Date().toISOString(),
        lastEscalatedFromCallSid: params.currentChildCallSid ?? rr.lastEscalatedFromCallSid,
        lastFailoverReason: params.reason,
        lastEscalatedAt: new Date().toISOString(),
        lastFailedAgentIndex: currentIndex,
        lastFailedAgentName: currentAgent?.name ?? null,
        lastFailedAgentNumber: currentAgent?.transferNumber ?? null,
        lastFailedAgentResult: params.reason,
        ...buildFirstAgentOutcomePatch({
          rr,
          currentIndex,
          currentAgent,
          result: params.reason,
        }),
      };

      await prisma.callAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "auto-transferred-fallback",
          resultJson: {
            ...result,
            transferNumber: fallbackTransferNumber,
            fallbackTransferNumber,
            roundRobin: nextRoundRobin,
          } as any,
        },
      });

      if (params.leadId ?? attempt.leadId) {
        await prisma.event.create({
          data: {
            leadId: (params.leadId ?? attempt.leadId)!,
            type: "transfer_fallback",
            detail: {
              attemptId: attempt.id,
              callId: attempt.providerId,
              reason: params.reason,
              currentChildCallSid: params.currentChildCallSid ?? null,
              failedAgentIndex: currentIndex,
              failedAgentName: currentAgent?.name ?? null,
              failedAgentNumber: currentAgent?.transferNumber ?? null,
              failedAgentResult: params.reason,
              nextIndex: agents.length,
              nextTransferNumber: fallbackTransferNumber,
              nextAgentName: null,
              fallback: true,
            } as any,
          },
        });
      }

      return {
        ok: true,
        failedAgentIndex: currentIndex,
        failedAgentName: currentAgent?.name ?? null,
        failedAgentNumber: currentAgent?.transferNumber ?? null,
        failedAgentResult: params.reason,
        nextIndex: agents.length,
        nextTransferNumber: fallbackTransferNumber,
        nextAgentName: null,
        fallback: true,
      };
    }

    await prisma.callAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "transfer-failover-exhausted",
        resultJson: {
          ...result,
          roundRobin: {
            ...rr,
            exhausted: true,
            exhaustedAt: new Date().toISOString(),
            lastFailoverReason: params.reason,
            lastEscalatedFromCallSid: params.currentChildCallSid ?? rr.lastEscalatedFromCallSid,
            lastFailedAgentIndex: currentIndex,
            lastFailedAgentName: currentAgent?.name ?? null,
            lastFailedAgentNumber: currentAgent?.transferNumber ?? null,
            lastFailedAgentResult: params.reason,
            ...buildFirstAgentOutcomePatch({
              rr,
              currentIndex,
              currentAgent,
              result: params.reason,
            }),
          },
        } as any,
      },
    });
    return { ok: false, reason: "pool_exhausted" as const };
  }

  const lastEscalatedFromCallSid = asNonEmptyString(rr.lastEscalatedFromCallSid);
  if (params.currentChildCallSid && lastEscalatedFromCallSid === params.currentChildCallSid) {
    return { ok: false, reason: "duplicate_escalation" as const };
  }

  const nextAgent = agents[nextIndex];
  const nextRoundRobin = {
    ...rr,
    selectedAgentIndex: nextIndex,
    selectedAgentName: nextAgent.name,
    selectedTransferNumber: nextAgent.transferNumber,
    lastEscalatedFromCallSid: params.currentChildCallSid ?? rr.lastEscalatedFromCallSid,
    lastFailoverReason: params.reason,
    lastEscalatedAt: new Date().toISOString(),
    lastFailedAgentIndex: currentIndex,
    lastFailedAgentName: currentAgent?.name ?? null,
    lastFailedAgentNumber: currentAgent?.transferNumber ?? null,
    lastFailedAgentResult: params.reason,
    ...buildFirstAgentOutcomePatch({
      rr,
      currentIndex,
      currentAgent,
      result: params.reason,
    }),
  };

  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "auto-transferred-failover",
      resultJson: {
        ...result,
        transferNumber: nextAgent.transferNumber,
        roundRobin: nextRoundRobin,
      } as any,
    },
  });

  if (params.leadId ?? attempt.leadId) {
    await prisma.event.create({
      data: {
        leadId: (params.leadId ?? attempt.leadId)!,
        type: "transfer_failover",
        detail: {
          attemptId: attempt.id,
          callId: attempt.providerId,
          reason: params.reason,
          currentChildCallSid: params.currentChildCallSid ?? null,
          failedAgentIndex: currentIndex,
          failedAgentName: currentAgent?.name ?? null,
          failedAgentNumber: currentAgent?.transferNumber ?? null,
          failedAgentResult: params.reason,
          nextIndex,
          nextTransferNumber: nextAgent.transferNumber,
          nextAgentName: nextAgent.name,
        } as any,
      },
    });
  }

  return {
    ok: true,
    failedAgentIndex: currentIndex,
    failedAgentName: currentAgent?.name ?? null,
    failedAgentNumber: currentAgent?.transferNumber ?? null,
    failedAgentResult: params.reason,
    nextIndex,
    nextTransferNumber: nextAgent.transferNumber,
    nextAgentName: nextAgent.name,
  };
}

function scheduleRingTimeoutFailover(params: {
  attemptId: string;
  leadId?: string | null;
  childCallSid: string;
}) {
  const timerKey = `${params.attemptId}:${params.childCallSid}`;
  if (failoverTimers.has(timerKey)) return;
  const timer = setTimeout(async () => {
    failoverTimers.delete(timerKey);
    try {
      const result = await executeFailoverToNextAgent({
        attemptId: params.attemptId,
        leadId: params.leadId,
        currentChildCallSid: params.childCallSid,
        reason: "ring-timeout",
      });
      console.log("transfer_failover_ring_timeout", {
        attemptId: params.attemptId,
        childCallSid: params.childCallSid,
        result,
      });
    } catch (error) {
      console.error("transfer_failover_ring_timeout_error", {
        attemptId: params.attemptId,
        childCallSid: params.childCallSid,
        error: String(error),
      });
    }
  }, FAILOVER_RING_TIMEOUT_SEC * 1000);
  failoverTimers.set(timerKey, timer);
}

function sendTwimlResponse(
  res: express.Response,
  xml: string,
  context: {
    branch: string;
    callSid?: string | null;
    parentCallSid?: string | null;
    dialCallSid?: string | null;
    dialCallStatus?: string | null;
    callStatus?: string | null;
    attemptId?: string | null;
    vapiCallId?: string | null;
  },
) {
  console.log("twilio_transfer_status_response", {
    ...context,
    contentType: "text/xml",
    bodyType: "twiml",
    bodyBytes: Buffer.byteLength(xml, "utf8"),
  });
  return res.type("text/xml").send(xml);
}

function sendPlainStatusResponse(
  res: express.Response,
  statusCode: number,
  body: string,
  context: {
    branch: string;
    callSid?: string | null;
    parentCallSid?: string | null;
    dialCallSid?: string | null;
    dialCallStatus?: string | null;
    callStatus?: string | null;
    attemptId?: string | null;
    vapiCallId?: string | null;
  },
) {
  console.log("twilio_transfer_status_response", {
    ...context,
    contentType: "text/plain",
    bodyType: "plain",
    statusCode,
    body,
  });
  return res.status(statusCode).send(body);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function handleTwilioStatusWebhook(req: express.Request, res: express.Response) {
  console.log("twilio_status_webhook_hit", {
    path: req.path,
    hasBody: !!req.body,
    callSid: asNonEmptyString(req.body?.CallSid) ?? null,
    parentCallSid: asNonEmptyString(req.body?.ParentCallSid) ?? null,
    dialCallSid: asNonEmptyString(req.body?.DialCallSid) ?? null,
    callStatus: asNonEmptyString(req.body?.CallStatus) ?? null,
    dialCallStatus: asNonEmptyString(req.body?.DialCallStatus) ?? null,
    answeredBy: asNonEmptyString(req.body?.AnsweredBy) ?? null,
    query: req.query,
  });

  const status = asNonEmptyString(req.body?.CallStatus) ?? "unknown";
  const callDurationSec = parseInteger(req.body?.CallDuration);
  const normalizedStatus = status.toLowerCase();
  const dialCallStatus = asNonEmptyString(req.body?.DialCallStatus)?.toLowerCase() ?? null;
  const answeredBy = asNonEmptyString(req.body?.AnsweredBy)?.toLowerCase() ?? null;
  const dialCallSid = asNonEmptyString(req.body?.DialCallSid);
  const dialCallDurationSec = parseInteger(req.body?.DialCallDuration);
  const context = await resolveTwilioContext(req.body, req.query as Record<string, unknown>);
  const isChildLeg = typeof context.parentCallSid === "string" && context.parentCallSid.startsWith("CA");
  const parentSid = context.parentSid;
  const callIdFromParentSid =
    !context.vapiCallId && parentSid
      ? (await prisma.callMetric.findFirst({
          where: { twilioParentCallSid: parentSid },
          orderBy: { updatedAt: "desc" },
          select: { callId: true },
        }))?.callId ?? null
      : null;
  let callIdForMetrics = context.vapiCallId ?? callIdFromParentSid;

  console.log("twilio_status", {
    leadId: context.leadId,
    attemptId: context.attemptId,
    status,
    callSid: context.callSid,
    parentCallSid: context.parentCallSid,
    vapiCallId: context.vapiCallId,
    callDurationSec,
    dialCallStatus,
    dialCallSid,
    dialCallDurationSec,
    answeredBy,
    callIdForMetrics,
  });

  if (context.parentSid && context.vapiCallId) {
    await upsertTwilioLink({
      parentSid: context.parentSid,
      vapiCallId: context.vapiCallId,
      attemptId: context.attemptId,
      leadId: context.leadId,
      childCallSid: isChildLeg ? context.callSid : null,
      childStatus: isChildLeg ? normalizedStatus : null,
    });
  }

  const effectiveChildCallSid = (isChildLeg ? context.callSid : null) ?? dialCallSid ?? null;
  const effectiveChildStatus = (isChildLeg ? normalizedStatus : null) ?? dialCallStatus ?? null;

  if (callIdForMetrics) {
    await prisma.callMetric.updateMany({
      where: { callId: callIdForMetrics },
      data: {
        twilioParentCallSid: context.parentSid ?? undefined,
        twilioTransferCallSid: effectiveChildCallSid ?? undefined,
        transferStatus: effectiveChildStatus ?? undefined,
      },
    });
  }

  const isCompleted = normalizedStatus === "completed";
  const hasPositiveDuration = Number.isFinite(callDurationSec) && (callDurationSec ?? 0) > 0;
  if (callIdForMetrics && isChildLeg && isCompleted && hasPositiveDuration) {
    await prisma.callMetric.updateMany({
      where: {
        callId: callIdForMetrics,
        OR: [
          { postTransferDurationSec: null },
          { postTransferDurationSec: { lt: callDurationSec as number } },
        ],
      },
      data: { postTransferDurationSec: callDurationSec as number },
    });
  }

  const shouldHandleFailover = !!effectiveChildCallSid && (isChildLeg || !!dialCallStatus);
  if (shouldHandleFailover) {
    const destinationNumberFromTwilio =
      asNonEmptyString(req.body?.To) ??
      asNonEmptyString(req.body?.Called) ??
      null;
    let attemptIdForFailover =
      context.attemptId ??
      (context.vapiCallId
        ? (await prisma.callAttempt.findFirst({
            where: { providerId: context.vapiCallId },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          }))?.id ?? null
        : null);

    if (!attemptIdForFailover && destinationNumberFromTwilio) {
      const normalizedDestination = normalizePhoneForMatch(destinationNumberFromTwilio);
      if (normalizedDestination) {
        const candidates = await prisma.callAttempt.findMany({
          where: {
            createdAt: {
              gte: new Date(Date.now() - 30 * 60 * 1000),
            },
            status: {
              in: ["sent", "auto-transferred", "auto-transferred-failover"],
            },
          },
          orderBy: { createdAt: "desc" },
          take: 40,
          select: { id: true, resultJson: true },
        });
        for (const candidate of candidates) {
          const transferNumber = extractSelectedTransferNumberFromResultJson(candidate.resultJson);
          if (!transferNumber) continue;
          if (normalizePhoneForMatch(transferNumber) === normalizedDestination) {
            attemptIdForFailover = candidate.id;
            break;
          }
        }
      }
    }

    if (!attemptIdForFailover) {
      const fallbackCandidates = await prisma.callAttempt.findMany({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 10 * 60 * 1000),
          },
          status: {
            in: ["sent", "auto-transferred", "auto-transferred-failover"],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, providerId: true, resultJson: true },
      });
      for (const candidate of fallbackCandidates) {
        const result = candidate.resultJson && typeof candidate.resultJson === "object"
          ? (candidate.resultJson as Record<string, unknown>)
          : null;
        const rr = result?.roundRobin && typeof result.roundRobin === "object"
          ? (result.roundRobin as Record<string, unknown>)
          : null;
        if (rr?.enabled === true) {
          attemptIdForFailover = candidate.id;
          callIdForMetrics = callIdForMetrics ?? candidate.providerId ?? null;
          break;
        }
      }
    }

    if (callIdForMetrics == null && attemptIdForFailover) {
      const attemptForCallId = await prisma.callAttempt.findUnique({
        where: { id: attemptIdForFailover },
        select: { providerId: true },
      });
      callIdForMetrics = attemptForCallId?.providerId ?? null;
    }

    if (callIdForMetrics) {
      await prisma.callMetric.updateMany({
        where: { callId: callIdForMetrics },
        data: {
          twilioParentCallSid: context.parentSid ?? undefined,
          twilioTransferCallSid: effectiveChildCallSid ?? undefined,
          transferStatus: effectiveChildStatus ?? undefined,
        },
      });
    }
    if (!attemptIdForFailover) {
      console.log("transfer_failover_skipped_missing_attempt", {
        callSid: effectiveChildCallSid,
        parentCallSid: context.parentCallSid,
        vapiCallId: context.vapiCallId,
      });
    } else {
      const effectiveStatusForReason = dialCallStatus ?? normalizedStatus;
      const machineAnswered = isMachineAnswered(answeredBy);
      const isAnsweredStatus =
        FAILOVER_ANSWERED_STATUSES.has(normalizedStatus) ||
        FAILOVER_ANSWERED_STATUSES.has(dialCallStatus ?? "");
      const isHumanAnswered = isAnsweredStatus && !machineAnswered;
      const statusFailoverReason = mapStatusToFailoverReason(effectiveStatusForReason);
      const isCompletedWithoutAnswer =
        (normalizedStatus === "completed" || dialCallStatus === "completed") &&
        (!Number.isFinite(dialCallDurationSec ?? callDurationSec) || ((dialCallDurationSec ?? callDurationSec) ?? 0) <= 0);
      const failoverReason: AgentFailoverReason | null =
        machineAnswered
          ? "voicemail"
          : statusFailoverReason ??
            (isCompletedWithoutAnswer ? "no-answer" : null);
      if (isHumanAnswered) {
        try {
          const attemptForAnswered = await prisma.callAttempt.findUnique({
            where: { id: attemptIdForFailover },
            select: { id: true, resultJson: true },
          });
          const resultForAnswered =
            attemptForAnswered?.resultJson && typeof attemptForAnswered.resultJson === "object"
              ? (attemptForAnswered.resultJson as Record<string, unknown>)
              : {};
          const rrForAnswered =
            resultForAnswered.roundRobin && typeof resultForAnswered.roundRobin === "object"
              ? (resultForAnswered.roundRobin as Record<string, unknown>)
              : null;
          if (rrForAnswered?.enabled === true) {
            const selectedIndex = asFiniteInteger(rrForAnswered.selectedAgentIndex) ?? 0;
            const agents = parseRoundRobinAgentsFromResultJson(resultForAnswered);
            const answeredAgent = agents[selectedIndex] ?? null;
            await prisma.callAttempt.update({
              where: { id: attemptIdForFailover },
              data: {
                resultJson: {
                  ...resultForAnswered,
                  roundRobin: {
                    ...rrForAnswered,
                    answeredAt: new Date().toISOString(),
                    answeredChildCallSid: effectiveChildCallSid,
                    answeredAgentIndex: selectedIndex,
                    answeredAgentName: answeredAgent?.name ?? null,
                    answeredAgentNumber: answeredAgent?.transferNumber ?? null,
                    answeredBy: "human",
                    answeredOutcome: "human-answered",
                    ...buildFirstAgentOutcomePatch({
                      rr: rrForAnswered,
                      currentIndex: selectedIndex,
                      currentAgent: answeredAgent,
                      result: "human-answered",
                    }),
                  },
                } as any,
              },
            });
          }
        } catch (error) {
          console.warn("round_robin_answered_agent_update_failed", {
            attemptId: attemptIdForFailover,
            callSid: effectiveChildCallSid,
            error: String(error),
          });
        }
      }

      const timerKey = `${attemptIdForFailover}:${effectiveChildCallSid}`;
      const hasFailureDialStatus = !!dialCallStatus && FAILOVER_FAILURE_STATUSES.has(dialCallStatus);
      const shouldFailoverFromStatus =
        !!failoverReason ||
        FAILOVER_FAILURE_STATUSES.has(normalizedStatus) ||
        hasFailureDialStatus;

      if (normalizedStatus === "ringing") {
        scheduleRingTimeoutFailover({
          attemptId: attemptIdForFailover,
          leadId: context.leadId,
          childCallSid: effectiveChildCallSid,
        });
      }
      if (FAILOVER_CLEAR_TIMER_STATUSES.has(normalizedStatus) || shouldFailoverFromStatus) {
        clearFailoverTimer(timerKey);
      }
      if (dialCallStatus && shouldFailoverFromStatus && failoverReason) {
        const twimlFailoverResult = await selectNextRoundRobinAgent({
          attemptId: attemptIdForFailover,
          leadId: context.leadId,
          currentChildCallSid: effectiveChildCallSid,
          reason: failoverReason,
        });
        if (twimlFailoverResult.ok && twimlFailoverResult.nextTransferNumber) {
          const callbackQs = new URLSearchParams();
          callbackQs.set("attempt_id", attemptIdForFailover);
          if (context.vapiCallId) callbackQs.set("vapi_call_id", context.vapiCallId);
          if (context.leadId) callbackQs.set("lead_id", context.leadId);
          const callbackPath = `/webhooks/twilio/transfer-status?${callbackQs.toString()}`;
          const callbackUrl = `${PUBLIC_API_BASE_URL}${callbackPath}`;
          const recordingCallbackPath = `/webhooks/twilio/recording-status?${callbackQs.toString()}`;
          const recordingCallbackUrl = `${PUBLIC_API_BASE_URL}${recordingCallbackPath}`;
          const callbackUrlXml = escapeXml(callbackUrl);
          const recordingCallbackUrlXml = escapeXml(recordingCallbackUrl);
          const nextTransferNumberXml = escapeXml(twimlFailoverResult.nextTransferNumber);
          const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="${FAILOVER_RING_TIMEOUT_SEC}" action="${callbackUrlXml}" method="POST" record="record-from-answer-dual" recordingStatusCallback="${recordingCallbackUrlXml}" recordingStatusCallbackMethod="POST"><Number statusCallback="${callbackUrlXml}" statusCallbackMethod="POST" statusCallbackEvent="initiated ringing answered completed busy no-answer failed canceled" machineDetection="DetectMessageEnd" amdStatusCallback="${callbackUrlXml}" amdStatusCallbackMethod="POST">${nextTransferNumberXml}</Number></Dial></Response>`;
          return sendTwimlResponse(res, xml, {
            branch: "dial-callback-failover-next-agent",
            callSid: context.callSid,
            parentCallSid: context.parentCallSid,
            dialCallSid,
            dialCallStatus,
            callStatus: normalizedStatus,
            attemptId: attemptIdForFailover,
            vapiCallId: context.vapiCallId,
          });
        }
        return sendTwimlResponse(res, '<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
          branch: "dial-callback-failover-empty",
          callSid: context.callSid,
          parentCallSid: context.parentCallSid,
          dialCallSid,
          dialCallStatus,
          callStatus: normalizedStatus,
          attemptId: attemptIdForFailover,
          vapiCallId: context.vapiCallId,
        });
      }
      if (shouldFailoverFromStatus) {
        try {
          const failoverResult = await executeFailoverToNextAgent({
            attemptId: attemptIdForFailover,
            leadId: context.leadId,
            currentChildCallSid: effectiveChildCallSid,
            reason: failoverReason ?? "failed",
          });
          console.log("transfer_failover_status_failed", {
            attemptId: attemptIdForFailover,
            childCallSid: effectiveChildCallSid,
            status: normalizedStatus,
            dialCallStatus,
            answeredBy,
            failoverReason,
            failoverResult,
          });
        } catch (error) {
          console.error("transfer_failover_status_failed_error", {
            attemptId: attemptIdForFailover,
            childCallSid: effectiveChildCallSid,
            status: normalizedStatus,
            error: String(error),
          });
        }
      }
    }
  }

  if (context.leadId) {
    await prisma.event.create({
      data: {
        leadId: context.leadId,
        type: "twilio_status",
        detail: {
          status,
          callSid: context.callSid,
          parentCallSid: context.parentCallSid,
          attemptId: context.attemptId,
          vapiCallId: context.vapiCallId,
          callDurationSec: Number.isFinite(callDurationSec) ? callDurationSec : null,
          answeredBy,
          isChildLeg,
          raw: req.body,
        },
      },
    });
  }
  // Twilio <Dial action="..."> callbacks include DialCallStatus and expect TwiML.
  // Returning plain text can trigger: "application error has occurred".
  if (dialCallStatus) {
    return sendTwimlResponse(res, '<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      branch: "dial-callback-default-empty",
      callSid: context.callSid,
      parentCallSid: context.parentCallSid,
      dialCallSid,
      dialCallStatus,
      callStatus: normalizedStatus,
      attemptId: context.attemptId,
      vapiCallId: context.vapiCallId,
    });
  }

  return sendPlainStatusResponse(res, 200, "ok", {
    branch: "non-dial-status-default-ok",
    callSid: context.callSid,
    parentCallSid: context.parentCallSid,
    dialCallSid,
    dialCallStatus,
    callStatus: normalizedStatus,
    attemptId: context.attemptId,
    vapiCallId: context.vapiCallId,
  });
}

async function handleTwilioTransferRecordingWebhook(req: express.Request, res: express.Response) {
  const context = await resolveTwilioContext(req.body, req.query as Record<string, unknown>);
  const callSid = asNonEmptyString(req.body?.CallSid) ?? context.callSid;
  const recordingSid = asNonEmptyString(req.body?.RecordingSid);
  const recordingStatus = asNonEmptyString(req.body?.RecordingStatus) ?? "unknown";
  const recordingDurationSec = parseInteger(req.body?.RecordingDuration);
  const recordingUrl = asNonEmptyString(req.body?.RecordingUrl);
  const vapiCallId = context.vapiCallId ?? context.link?.vapiCallId ?? null;

  console.log("twilio_transfer_recording", {
    leadId: context.leadId,
    attemptId: context.attemptId,
    vapiCallId,
    callSid,
    recordingSid,
    recordingStatus,
    recordingDurationSec,
    hasRecordingUrl: !!recordingUrl,
  });

  if (vapiCallId && context.parentSid) {
    await upsertTwilioLink({
      parentSid: context.parentSid,
      vapiCallId,
      attemptId: context.attemptId,
      leadId: context.leadId,
      childCallSid: callSid,
    });
  }

  if (vapiCallId) {
    const metric = await prisma.callMetric.findUnique({
      where: { callId: vapiCallId },
      select: {
        callId: true,
        recordingUrl: true,
        recordingsJson: true,
        postTransferDurationSec: true,
      },
    });
    if (metric) {
      const nextPostTransferDurationSec =
        recordingDurationSec !== null && recordingDurationSec > (metric.postTransferDurationSec ?? 0)
          ? recordingDurationSec
          : metric.postTransferDurationSec;
      const nextRecordingsJson = mergeRecordingsJson(metric.recordingsJson, {
        vapiUrl: metric.recordingUrl,
        twilioTransferUrl: recordingUrl,
        twilioTransferDurationSec: recordingDurationSec,
        twilioTransferCallSid: callSid,
        twilioRecordingSid: recordingSid,
        twilioRecordingStatus: recordingStatus,
      });

      await prisma.callMetric.update({
        where: { callId: vapiCallId },
        data: {
          twilioTransferCallSid: callSid ?? undefined,
          transferRecordingUrl: recordingUrl ?? undefined,
          transferRecordingDurationSec: recordingDurationSec ?? undefined,
          postTransferDurationSec: nextPostTransferDurationSec ?? undefined,
          recordingsJson: nextRecordingsJson as any,
        },
      });
    }
  }

  if (context.leadId) {
    await prisma.event.create({
      data: {
        leadId: context.leadId,
        type: "twilio_transfer_recording",
        detail: {
          callSid,
          parentCallSid: context.parentCallSid,
          attemptId: context.attemptId,
          vapiCallId,
          recordingSid,
          recordingStatus,
          recordingDurationSec,
          recordingUrl,
          raw: req.body,
        },
      },
    });
  }

  res.status(200).send("ok");
}

async function handleTwilioTransferTranscriptionWebhook(req: express.Request, res: express.Response) {
  const context = await resolveTwilioContext(req.body, req.query as Record<string, unknown>);
  const callSid = asNonEmptyString(req.body?.CallSid) ?? context.callSid;
  const transcriptionSid = asNonEmptyString(req.body?.TranscriptionSid);
  const transcriptionStatus = asNonEmptyString(req.body?.TranscriptionStatus) ?? "unknown";
  const transcriptionText = asNonEmptyString(req.body?.TranscriptionText);
  const vapiCallId = context.vapiCallId ?? context.link?.vapiCallId ?? null;

  console.log("twilio_transfer_transcription", {
    leadId: context.leadId,
    attemptId: context.attemptId,
    vapiCallId,
    callSid,
    transcriptionSid,
    transcriptionStatus,
    hasTranscript: !!transcriptionText,
  });

  if (vapiCallId && context.parentSid) {
    await upsertTwilioLink({
      parentSid: context.parentSid,
      vapiCallId,
      attemptId: context.attemptId,
      leadId: context.leadId,
      childCallSid: callSid,
    });
  }

  if (vapiCallId && transcriptionText) {
    const metric = await prisma.callMetric.findUnique({
      where: { callId: vapiCallId },
      select: {
        callId: true,
        transcript: true,
        transferTranscript: true,
      },
    });
    if (metric) {
      const nextTransferTranscript =
        metric.transferTranscript && metric.transferTranscript.includes(transcriptionText)
          ? metric.transferTranscript
          : metric.transferTranscript
            ? `${metric.transferTranscript}\n${transcriptionText}`
            : transcriptionText;
      const nextFullTranscript = composeFullTranscript(metric.transcript, nextTransferTranscript);
      await prisma.callMetric.update({
        where: { callId: vapiCallId },
        data: {
          twilioTransferCallSid: callSid ?? undefined,
          transferTranscript: nextTransferTranscript,
          fullTranscript: nextFullTranscript ?? undefined,
        },
      });
    }
  }

  if (context.leadId) {
    await prisma.event.create({
      data: {
        leadId: context.leadId,
        type: "twilio_transfer_transcription",
        detail: {
          callSid,
          parentCallSid: context.parentCallSid,
          attemptId: context.attemptId,
          vapiCallId,
          transcriptionSid,
          transcriptionStatus,
          transcriptionText,
          raw: req.body,
        },
      },
    });
  }

  res.status(200).send("ok");
}

app.post("/webhooks/twilio/status", handleTwilioStatusWebhook);
app.post("/webhooks/twilio/transfer-status", handleTwilioStatusWebhook);
app.post("/webhooks/twilio/transfer-recording", handleTwilioTransferRecordingWebhook);
app.post("/webhooks/twilio/transfer-transcription", handleTwilioTransferTranscriptionWebhook);

app.post("/webhooks/vapi/result", async (req, res) => {
  let leadId = extractLeadId(req.body) ?? (req.query.lead_id as string | undefined) ?? null;
  let attemptId = extractAttemptId(req.body);
  const providerId = extractVapiCallId(req.body);

  if (!attemptId && providerId) {
    const attemptByProvider = await prisma.callAttempt.findFirst({
      where: { providerId },
      orderBy: { createdAt: "desc" },
    });
    if (attemptByProvider) {
      attemptId = attemptByProvider.id;
      leadId = leadId ?? attemptByProvider.leadId;
    }
  }

  console.log("vapi_result", { leadId, attemptId, providerId });

  const transcript = extractTranscriptFromVapiPayload(req.body);
  const normalizedDetail =
    transcript && req.body && typeof req.body === "object"
      ? { ...(req.body as Record<string, unknown>), transcript }
      : (req.body ?? {});

  if (leadId) {
    await prisma.event.create({
      data: {
        leadId,
        type: "vapi_result",
        detail: normalizedDetail as any,
      },
    });
  }

  if (attemptId) {
    await prisma.callAttempt.update({
      where: { id: attemptId },
      data: { resultJson: normalizedDetail as any },
    });
  }

  res.status(200).json({ ok: true });
});

const port = Number(process.env.PORT ?? 3000);

const VAPI_API_KEY = process.env.VAPI_API_KEY ?? "";
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID ?? "";
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID ?? "";

// ============ MULTI-LANGUAGE SUPPORT ============

/** Assistant ID to language mapping */
const ASSISTANT_LANGUAGES: Record<string, 'es' | 'en'> = {
  '675d2cb2-7047-4949-8735-bedb29351991': 'es', // 1-ES-F Marina
  '5ac0c5dd-2e79-4d29-b76a-add2ff1b93b7': 'en', // 2-EN-F Rachel
  '6b9e8a41-43f5-4439-b14c-6c842fee7d66': 'en', // 3-EN-F Bella
};

/** Get language for assistant, defaults to Spanish */
function getLanguageForAssistant(assistantId: string): 'es' | 'en' {
  return ASSISTANT_LANGUAGES[assistantId] || 'es';
}

// ============ BUSINESS HOURS HELPERS ============

const callSchema = z.object({
  lead_id: z.string().uuid(),
  to_number: z.string().min(6),
});

app.post("/call/test", async (req, res) => {
  if (!VAPI_API_KEY || !VAPI_PHONE_NUMBER_ID || !VAPI_ASSISTANT_ID) {
    return res.status(400).json({
      error: "missing_vapi_config",
      required: ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "VAPI_ASSISTANT_ID"],
    });
  }

  const parsed = callSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  }

  const { lead_id, to_number } = parsed.data;

  const lead = await prisma.lead.findUnique({ where: { id: lead_id } });
  if (!lead) return res.status(404).json({ error: "lead_not_found" });

  const attempt = await prisma.callAttempt.create({
    data: {
      leadId: lead.id,
      status: "initiated",
    },
  });

  const payload = {
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    assistantId: VAPI_ASSISTANT_ID,
    customer: {
      number: to_number,
    },
    metadata: {
      lead_id: lead.id,
      attempt_id: attempt.id,
    },
  };

  let resp: Response;
  let data: any = {};
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    resp = await fetch("https://api.vapi.ai/call/phone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VAPI_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    data = await resp.json().catch(() => ({}));
  } catch (error) {
    return res.status(502).json({
      error: "vapi_network_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  await prisma.event.create({
    data: {
      leadId: lead.id,
      type: "vapi_call_request",
      detail: { request: payload, response: data, status: resp.status } as any,
    },
  });

  if (!resp.ok) {
    return res.status(502).json({ error: "vapi_call_failed", status: resp.status, data });
  }

  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: { 
      status: "sent", 
      providerId: typeof data.id === "string" ? data.id : null,
      controlUrl: data?.monitor?.controlUrl ?? null,
    },
  });
  await linkAttemptWithTwilioParentSid({
    vapiCallId: typeof data.id === "string" ? data.id : null,
    attemptId: attempt.id,
    leadId: lead.id,
    vapiResponse: data,
  });

  return res.json({ ok: true, attempt_id: attempt.id, vapi: data });
});

const callDirectSchema = z.object({
  vapi_api_key: z.string().min(10).optional(),
  vapi_phone_number_id: z.string().min(6).optional(),
  vapi_assistant_id: z.string().min(6).optional(),
  transfer_number: z.string().min(6).optional(),
  round_robin_enabled: z.boolean().optional(),
  round_robin_agents: z.array(
    z.object({
      name: z.string().min(1).max(80).optional(),
      transfer_number: z.string().min(6),
    }),
  ).min(1).max(5).optional(),
  to_number: z.string().min(6),
  lead_id: z.string().uuid().optional(),
  lead_name: z.string().min(1).max(80).optional(),
  lead_source: z.string().min(1).optional(),
});

// ============ SHARED HELPERS FOR CALL ENDPOINTS ============

/** Sanitize name for TTS: collapse whitespace, remove control chars, trim */
function sanitizeName(name: string): string {
  return name
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .replace(/\s+/g, ' ')            // Collapse whitespace
    .trim()
    .slice(0, 80);                   // Enforce max length
}

/** Build assistantOverrides for VAPI calls.
 *
 * IMPORTANT: Keep behavior 100% VAPI-configured.
 * Do not send firstMessage/model/tools overrides from backend.
 */
function buildAssistantOverrides(
  safeName: string | null,
  leadId: string,
  attemptId: string,
  transferNumber?: string | null,
  agentName?: string | null,
): Record<string, unknown> {
  const metadata = { lead_id: leadId, attempt_id: attemptId };
  const variableValues: Record<string, string> = {};
  if (safeName) variableValues.name = safeName;
  if (transferNumber) variableValues.transfer_number = transferNumber;
  if (agentName) variableValues.agent_name = agentName;
  const overrides: Record<string, unknown> = { metadata };
  if (Object.keys(variableValues).length) overrides.variableValues = variableValues;
  if (transferNumber) {
    overrides.model = {
      provider: "openai",
      model: "gpt-4o-mini",
      tools: [
        {
          type: "transferCall",
          destinations: [{
            type: "number",
            number: transferNumber,
            transferPlan: { mode: "blind-transfer" }
          }],
        },
      ],
    };
  }
  return overrides;
}

function parseDateValue(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pickVapiDate(data: Record<string, unknown>, keys: string[]): Date | null {
  for (const key of keys) {
    const date = parseDateValue(data[key]);
    if (date) return date;
  }
  return null;
}

function extractVapiRecordingUrl(data: Record<string, unknown>): string | null {
  const artifact = data.artifact && typeof data.artifact === "object" ? data.artifact as Record<string, unknown> : null;
  const recording = artifact?.recording && typeof artifact.recording === "object" ? artifact.recording as Record<string, unknown> : null;
  const mono = recording?.mono && typeof recording.mono === "object" ? recording.mono as Record<string, unknown> : null;
  return (
    (typeof data.recordingUrl === "string" && data.recordingUrl) ||
    (typeof artifact?.recordingUrl === "string" && artifact.recordingUrl) ||
    (typeof mono?.combinedUrl === "string" && mono.combinedUrl) ||
    (typeof data.stereoRecordingUrl === "string" && data.stereoRecordingUrl) ||
    (typeof artifact?.stereoRecordingUrl === "string" && artifact.stereoRecordingUrl) ||
    null
  );
}

async function upsertDashboardMetricFromVapiCall(params: {
  data: Record<string, unknown>;
  fallbackPhone: string;
  fallbackAssistantId: string | null;
  transferNumber: string | null;
  lastEventType: string;
}) {
  const callId = typeof params.data.id === "string" ? params.data.id : null;
  if (!callId) return;

  const customer = params.data.customer && typeof params.data.customer === "object"
    ? params.data.customer as Record<string, unknown>
    : null;
  const status = typeof params.data.status === "string" ? params.data.status.toLowerCase() : null;
  const endedReason = typeof params.data.endedReason === "string" ? params.data.endedReason : null;
  const startedAt = pickVapiDate(params.data, ["startedAt", "createdAt"]) ?? new Date();
  const endedAt = pickVapiDate(params.data, ["endedAt", "updatedAt"]);
  const isEnded = status === "ended" || Boolean(endedReason || endedAt);
  const duration = typeof params.data.duration === "number" && Number.isFinite(params.data.duration)
    ? Math.max(0, Math.round(params.data.duration))
    : null;
  const transcript =
    (typeof params.data.transcript === "string" && params.data.transcript) ||
    (params.data.artifact && typeof params.data.artifact === "object" && typeof (params.data.artifact as Record<string, unknown>).transcript === "string"
      ? (params.data.artifact as Record<string, string>).transcript
      : null) ||
    buildTranscriptFromMessages(params.data.messages);
  const cost = typeof params.data.cost === "number" && Number.isFinite(params.data.cost) ? params.data.cost : undefined;

  await prisma.callMetric.upsert({
    where: { callId },
    create: {
      callId,
      phoneNumber: typeof customer?.number === "string" ? customer.number : params.fallbackPhone,
      assistantId: typeof params.data.assistantId === "string" ? params.data.assistantId : params.fallbackAssistantId,
      transferNumber: params.transferNumber,
      startedAt,
      endedAt: isEnded ? (endedAt ?? new Date()) : undefined,
      durationSec: duration,
      endedReason,
      outcome: isEnded ? (endedReason === "assistant-forwarded-call" ? "transfer_success" : "completed") : "in_progress",
      sentiment: isEnded ? "neutral" : undefined,
      transcript: transcript ?? undefined,
      recordingUrl: extractVapiRecordingUrl(params.data) ?? undefined,
      cost,
      inProgress: !isEnded,
      lastEventType: params.lastEventType,
      lastEventAt: new Date(),
    },
    update: {
      phoneNumber: typeof customer?.number === "string" ? customer.number : params.fallbackPhone,
      assistantId: typeof params.data.assistantId === "string" ? params.data.assistantId : params.fallbackAssistantId,
      transferNumber: params.transferNumber,
      startedAt,
      endedAt: isEnded ? (endedAt ?? new Date()) : undefined,
      durationSec: duration ?? undefined,
      endedReason,
      outcome: isEnded ? (endedReason === "assistant-forwarded-call" ? "transfer_success" : "completed") : "in_progress",
      sentiment: isEnded ? "neutral" : undefined,
      transcript: transcript ?? undefined,
      recordingUrl: extractVapiRecordingUrl(params.data) ?? undefined,
      cost,
      inProgress: !isEnded,
      lastEventType: params.lastEventType,
      lastEventAt: new Date(),
    },
  });
}

app.post("/call/test/direct", async (req, res) => {
  const callWindow = canStartOutboundCall();
  if (!callWindow.allowed) {
    return res.status(400).json({
      error: "outside_business_hours",
      message: "Llamadas fuera de horario habilitado",
      call_window: callWindow,
    });
  }

  const parsed = callDirectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  }

  const {
    vapi_api_key,
    vapi_phone_number_id,
    vapi_assistant_id,
    transfer_number,
    round_robin_enabled,
    round_robin_agents,
    to_number,
    lead_id,
    lead_name,
    lead_source,
  } =
    parsed.data;
  const resolvedVapiApiKey = vapi_api_key ?? VAPI_API_KEY;
  const resolvedVapiPhoneNumberId = vapi_phone_number_id ?? VAPI_PHONE_NUMBER_ID;
  const resolvedVapiAssistantId = vapi_assistant_id ?? VAPI_ASSISTANT_ID;
  const fallbackTransferNumber = transfer_number ?? null;
  const safeName = lead_name ? sanitizeName(lead_name) : null;
  const requestAgents = getRoundRobinHumanAgentsFromRequest(round_robin_agents);
  const envAgents = getRoundRobinHumanAgentsFromEnv();
  const configuredRoundRobinAgents = requestAgents.length ? requestAgents : envAgents;
  const roundRobinRequested = round_robin_enabled === true || requestAgents.length > 0;
  const shouldUseRoundRobin = roundRobinRequested && configuredRoundRobinAgents.length > 0;
  if (!fallbackTransferNumber) {
    return res.status(400).json({
      error: "missing_transfer_number",
      message: "Configura Número de transferencia (E.164) en Lab; no hay fallback por env ni hardcodeado.",
      required: ["transfer_number"],
    });
  }
  let selectedTransferNumber = fallbackTransferNumber;
  let selectedAgentName: string | null = null;
  let selectedAgentIndex: number | null = null;
  if (shouldUseRoundRobin) {
    // Sequential failover strategy:
    // every call starts with first agent in pool (index 0) and failover escalates to 1..N.
    selectedAgentIndex = 0;
    const selectedAgent = configuredRoundRobinAgents[selectedAgentIndex];
    selectedTransferNumber = selectedAgent.transferNumber;
    selectedAgentName = selectedAgent.name ?? null;
  }

  if (!resolvedVapiApiKey || !resolvedVapiPhoneNumberId || !resolvedVapiAssistantId) {
    return res.status(400).json({
      error: "missing_vapi_config",
      required: ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "VAPI_ASSISTANT_ID"],
    });
  }

  const lead =
    lead_id
      ? await prisma.lead.findUnique({ where: { id: lead_id } })
      : await prisma.lead.create({
          data: {
            name: safeName ?? "Test",
            phone: to_number,
            source: lead_source ?? "manual",
            events: { create: { type: "lead_received", detail: { source: lead_source ?? null } } },
          },
        });

  if (!lead) return res.status(404).json({ error: "lead_not_found" });

  const attempt = await prisma.callAttempt.create({
    data: {
      leadId: lead.id,
      status: "initiated",
    },
  });

  // Build payload with assistantOverrides for personalized greeting (language-aware)
  const language = getLanguageForAssistant(resolvedVapiAssistantId);
  const assistantOverrides = buildAssistantOverrides(
    safeName,
    lead.id,
    attempt.id,
    selectedTransferNumber,
    selectedAgentName,
  );
  const payload = {
    phoneNumberId: resolvedVapiPhoneNumberId,
    assistantId: resolvedVapiAssistantId,
    customer: { number: to_number },
    assistantOverrides,
  };

  let resp: Response;
  let data: any = {};
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    resp = await fetch("https://api.vapi.ai/call/phone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolvedVapiApiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    data = await resp.json().catch(() => ({}));
  } catch (error) {
    return res.status(502).json({
      error: "vapi_network_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  await prisma.event.create({
    data: {
      leadId: lead.id,
      type: "vapi_call_request",
      detail: { 
        request: payload, 
        response: data, 
        status: resp.status,
        flow: safeName ? "with_name" : "without_name",
        language,
        roundRobin: shouldUseRoundRobin
          ? {
              enabled: true,
              strategy: "sequential_failover",
              selectedAgentIndex,
              selectedAgentName,
              selectedTransferNumber,
              fallbackTransferNumber,
              poolSize: configuredRoundRobinAgents.length,
              agents: buildRoundRobinAgentsSnapshot(configuredRoundRobinAgents),
            }
          : { enabled: false, fallbackTransferNumber },
      } as any,
    },
  });

  if (!resp.ok) {
    return res.status(502).json({ error: "vapi_call_failed", status: resp.status, data });
  }

  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: { 
      status: "sent", 
      providerId: typeof data.id === "string" ? data.id : null,
      controlUrl: data?.monitor?.controlUrl ?? null,
      resultJson: {
        transferNumber: selectedTransferNumber,
        fallbackTransferNumber,
        roundRobin: shouldUseRoundRobin
          ? {
              enabled: true,
              strategy: "sequential_failover",
              selectedAgentIndex,
              selectedAgentName,
              selectedTransferNumber,
              fallbackTransferNumber,
              poolSize: configuredRoundRobinAgents.length,
              agents: buildRoundRobinAgentsSnapshot(configuredRoundRobinAgents),
            }
          : { enabled: false, fallbackTransferNumber },
      } as any,
    },
  });
  await linkAttemptWithTwilioParentSid({
    vapiCallId: typeof data.id === "string" ? data.id : null,
    attemptId: attempt.id,
    leadId: lead.id,
    vapiResponse: data,
  });
  await upsertDashboardMetricFromVapiCall({
    data,
    fallbackPhone: to_number,
    fallbackAssistantId: resolvedVapiAssistantId,
    transferNumber: selectedTransferNumber,
    lastEventType: "call-created",
  });

  return res.json({ 
    ok: true, 
    attempt_id: attempt.id,
    lead_id: lead.id,
    flow: safeName ? "with_name" : "without_name",
    language,
    selected_agent: {
      assistant_id: resolvedVapiAssistantId,
      human_agent_name: selectedAgentName,
      transfer_number: selectedTransferNumber,
      fallback_transfer_number: fallbackTransferNumber,
      round_robin_enabled: shouldUseRoundRobin,
      round_robin_index: selectedAgentIndex,
      round_robin_pool_size: shouldUseRoundRobin ? configuredRoundRobinAgents.length : 0,
    },
    vapi: data 
  });
});

// ============ PRODUCTION CALL ENDPOINT ============

const callVapiSchema = z.object({
  to_number: z.string().min(6),
  transfer_number: z.string().min(6).optional(),
  lead_name: z.string().min(1).max(80).optional(),
  lead_id: z.string().uuid().optional(),
  lead_source: z.string().min(1).optional(),
  round_robin_enabled: z.boolean().optional(),
  round_robin_agents: z.array(
    z.object({
      name: z.string().min(1).max(80).optional(),
      transfer_number: z.string().min(6),
    }),
  ).min(1).max(5).optional(),
});

type RoundRobinHumanAgent = {
  name?: string;
  transferNumber: string;
};

const MAX_ROUND_ROBIN_AGENTS = 5;

function buildRoundRobinAgentsSnapshot(agents: RoundRobinHumanAgent[]) {
  return agents.map((agent) => ({
    ...(agent.name ? { name: agent.name } : {}),
    transferNumber: agent.transferNumber,
  }));
}

function parseCsvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getRoundRobinHumanAgentsFromEnv(): RoundRobinHumanAgent[] {
  const transferNumbers = parseCsvList(process.env.HUMAN_AGENT_NUMBERS || process.env.TRANSFER_NUMBERS)
    .slice(0, MAX_ROUND_ROBIN_AGENTS);
  const names = parseCsvList(process.env.HUMAN_AGENT_NAMES);
  if (!transferNumbers.length) return [];
  return transferNumbers.map((transferNumber, index) => ({
    transferNumber,
    name: names[index],
  }));
}

function getRoundRobinHumanAgentsFromRequest(
  agents: Array<{ name?: string; transfer_number: string }> | undefined,
): RoundRobinHumanAgent[] {
  if (!agents?.length) return [];
  return agents.slice(0, MAX_ROUND_ROBIN_AGENTS).map((agent) => ({
    name: agent.name?.trim() || undefined,
    transferNumber: agent.transfer_number,
  }));
}

app.post("/call/vapi", async (req, res) => {
  // 🚫 VALIDATE BUSINESS HOURS FIRST
  const callWindow = canStartOutboundCall();
  if (!callWindow.allowed) {
    return res.status(400).json({
      error: 'outside_business_hours',
      message: 'Llamadas fuera de horario habilitado',
      call_window: callWindow,
    });
  }

  const parsed = callVapiSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  }

  const { to_number, transfer_number, lead_name, lead_id, lead_source, round_robin_enabled, round_robin_agents } = parsed.data;
  const fallbackTransferNumber = transfer_number ?? null;
  const safeName = lead_name ? sanitizeName(lead_name) : null;
  const requestAgents = getRoundRobinHumanAgentsFromRequest(round_robin_agents);
  const envAgents = getRoundRobinHumanAgentsFromEnv();
  const configuredRoundRobinAgents = requestAgents.length ? requestAgents : envAgents;
  const roundRobinRequested = round_robin_enabled === true || requestAgents.length > 0;
  const shouldUseRoundRobin = roundRobinRequested && configuredRoundRobinAgents.length > 0;
  const selectedAssistantId = VAPI_ASSISTANT_ID;

  if (!VAPI_API_KEY || !VAPI_PHONE_NUMBER_ID || !selectedAssistantId) {
    return res.status(400).json({
      error: "missing_vapi_config",
      required: ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "VAPI_ASSISTANT_ID"],
    });
  }

  if (!fallbackTransferNumber) {
    return res.status(400).json({
      error: "missing_transfer_number",
      message: "Configura transfer_number; no hay fallback por env ni hardcodeado.",
      required: ["transfer_number"],
    });
  }

  let selectedTransferNumber = fallbackTransferNumber;
  let selectedAgentName: string | null = null;
  let selectedAgentIndex: number | null = null;
  if (shouldUseRoundRobin) {
    // Sequential failover strategy:
    // every call starts with first agent in pool (index 0) and failover escalates to 1..N.
    selectedAgentIndex = 0;
    const selectedAgent = configuredRoundRobinAgents[selectedAgentIndex];
    selectedTransferNumber = selectedAgent.transferNumber;
    selectedAgentName = selectedAgent.name ?? null;
  }

  // Get or create lead
  const lead =
    lead_id
      ? await prisma.lead.findUnique({ where: { id: lead_id } })
      : await prisma.lead.create({
          data: {
            name: safeName ?? undefined,
            phone: to_number,
            source: lead_source ?? "vapi-call",
            events: { create: { type: "lead_received", detail: { source: lead_source ?? "vapi-call" } } },
          },
        });

  if (!lead) return res.status(404).json({ error: "lead_not_found" });

  // Create attempt record
  const attempt = await prisma.callAttempt.create({
    data: {
      leadId: lead.id,
      status: "initiated",
    },
  });

  // Build VAPI payload using shared helper (language-aware)
  const language = getLanguageForAssistant(selectedAssistantId);
  const assistantOverrides = buildAssistantOverrides(
    safeName,
    lead.id,
    attempt.id,
    selectedTransferNumber,
    selectedAgentName,
  );
  const payload = {
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    assistantId: selectedAssistantId,
    customer: { number: to_number },
    assistantOverrides,
  };

  let resp: Response;
  let data: any = {};
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    resp = await fetch("https://api.vapi.ai/call/phone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VAPI_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    data = await resp.json().catch(() => ({}));
  } catch (error) {
    return res.status(502).json({
      error: "vapi_network_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  await prisma.event.create({
    data: {
      leadId: lead.id,
      type: "vapi_call_request",
      detail: { 
        request: payload, 
        response: data, 
        status: resp.status,
        flow: safeName ? "with_name" : "without_name",
        language,
        roundRobin: shouldUseRoundRobin
          ? {
              enabled: true,
              strategy: "sequential_failover",
              selectedAgentIndex,
              selectedAgentName,
              selectedTransferNumber,
              fallbackTransferNumber,
              poolSize: configuredRoundRobinAgents.length,
              agents: buildRoundRobinAgentsSnapshot(configuredRoundRobinAgents),
            }
          : { enabled: false, fallbackTransferNumber },
      } as any,
    },
  });

  if (!resp.ok) {
    await prisma.callAttempt.update({
      where: { id: attempt.id },
      data: { status: "failed" },
    });
    return res.status(502).json({ error: "vapi_call_failed", status: resp.status, data });
  }

  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: { 
      status: "sent", 
      providerId: typeof data.id === "string" ? data.id : null,
      controlUrl: data?.monitor?.controlUrl ?? null,
      resultJson: {
        transferNumber: selectedTransferNumber,
        fallbackTransferNumber,
        assistantId: selectedAssistantId,
        roundRobin: shouldUseRoundRobin
          ? {
              enabled: true,
              strategy: "sequential_failover",
              selectedAgentIndex,
              selectedAgentName,
              selectedTransferNumber,
              fallbackTransferNumber,
              poolSize: configuredRoundRobinAgents.length,
              agents: buildRoundRobinAgentsSnapshot(configuredRoundRobinAgents),
            }
          : { enabled: false, fallbackTransferNumber },
      } as any,
    },
  });
  await linkAttemptWithTwilioParentSid({
    vapiCallId: typeof data.id === "string" ? data.id : null,
    attemptId: attempt.id,
    leadId: lead.id,
    vapiResponse: data,
  });
  await upsertDashboardMetricFromVapiCall({
    data,
    fallbackPhone: to_number,
    fallbackAssistantId: selectedAssistantId,
    transferNumber: selectedTransferNumber,
    lastEventType: "call-created",
  });

  return res.json({ 
    ok: true, 
    attempt_id: attempt.id, 
    lead_id: lead.id,
    flow: safeName ? "with_name" : "without_name",
    language,
    selected_agent: {
      assistant_id: selectedAssistantId,
      human_agent_name: selectedAgentName,
      transfer_number: selectedTransferNumber,
      fallback_transfer_number: fallbackTransferNumber,
      round_robin_enabled: shouldUseRoundRobin,
      round_robin_index: selectedAgentIndex,
      round_robin_pool_size: shouldUseRoundRobin ? configuredRoundRobinAgents.length : 0,
    },
    vapi: data 
  });
});

const validateSchema = z.object({
  vapi_api_key: z.string().min(10),
  vapi_phone_number_id: z.string().min(6),
  vapi_assistant_id: z.string().min(6),
});

app.post("/vapi/validate", async (req, res) => {
  const parsed = validateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  }

  const { vapi_api_key, vapi_phone_number_id, vapi_assistant_id } = parsed.data;
  const headers = { Authorization: `Bearer ${vapi_api_key}` };

  const [assistantsResp, phoneResp] = await Promise.all([
    fetch("https://api.vapi.ai/assistant", { headers }),
    fetch("https://api.vapi.ai/phone-number", { headers }),
  ]);

  const assistants = await assistantsResp.json().catch(() => []);
  const phoneNumbers = await phoneResp.json().catch(() => []);

  const assistantOk = Array.isArray(assistants) && assistants.some((a) => a?.id === vapi_assistant_id);
  const phoneOk = Array.isArray(phoneNumbers) && phoneNumbers.some((p) => p?.id === vapi_phone_number_id);

  return res.json({
    ok: assistantsResp.ok && phoneResp.ok,
    assistantOk,
    phoneOk,
    assistantStatus: assistantsResp.status,
    phoneStatus: phoneResp.status,
  });
});

const vapiKeySchema = z.object({
  vapi_api_key: z.string().min(10),
});

app.post("/vapi/assistants", async (req, res) => {
  const parsed = vapiKeySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  }
  const headers = { Authorization: `Bearer ${parsed.data.vapi_api_key}` };
  const resp = await fetch("https://api.vapi.ai/assistant", { headers });
  const data = await resp.json().catch(() => []);
  return res.status(resp.status).json(data);
});

app.post("/vapi/phone-numbers", async (req, res) => {
  const parsed = vapiKeySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  }
  const headers = { Authorization: `Bearer ${parsed.data.vapi_api_key}` };
  const resp = await fetch("https://api.vapi.ai/phone-number", { headers });
  const data = await resp.json().catch(() => []);
  return res.status(resp.status).json(data);
});

app.get("/lab/history", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;

  if (from && Number.isNaN(from.getTime())) {
    return res.status(400).json({ error: "invalid_query", field: "from" });
  }
  if (to && Number.isNaN(to.getTime())) {
    return res.status(400).json({ error: "invalid_query", field: "to" });
  }

  const attempts = await prisma.callAttempt.findMany({
    where: {
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { lead: true },
  });

  const leadIds = Array.from(new Set(attempts.map((a: { leadId: string }) => a.leadId)));
  const events = await prisma.event.findMany({
    where: { leadId: { in: leadIds } },
    orderBy: { createdAt: "desc" },
    take: limit * 4,
  });

  return res.json({ attempts, events });
});

const callWindowSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  timezone: z.string().min(1).max(80).optional(),
  startHour: z.number().int().min(0).max(23).optional(),
  endHour: z.number().int().min(0).max(23).optional(),
  activeWeekdays: z.array(z.number().int().min(0).max(6)).optional(),
  applyToRoundRobinFailover: z.boolean().optional(),
  reset: z.boolean().optional(),
});

const labGhlAgentScopeSchema = z.object({
  propertyKey: z.string().min(1).max(80),
  campaignId: z.string().min(1).max(120).optional(),
});

const labGhlAgentsSaveSchema = labGhlAgentScopeSchema.extend({
  agents: z.array(z.object({
    name: z.string().min(1).max(120),
    ghlUserId: z.string().min(1).max(120),
    transferNumber: z.string().min(6).max(32),
    priority: z.number().int().min(1).max(5),
    active: z.boolean().optional(),
  })).max(5),
  fallback: z.object({
    name: z.string().max(120).optional(),
    ghlUserId: z.string().max(120).optional(),
    transferNumber: z.string().max(32).optional(),
  }).optional(),
});

const adminGhlCampaignSchema = z.object({
  campaignId: z.string().min(1).max(120),
  clientName: z.string().max(160).optional(),
  propertyKey: z.string().min(1).max(80),
  name: z.string().min(1).max(140),
  language: z.enum(["es", "en"]).default("es"),
  vapiAssistantId: z.string().min(6).max(160),
  vapiPhoneNumberId: z.string().min(6).max(160),
  ghlLocationId: z.string().max(160).optional(),
  ghlApiKey: z.string().max(500).optional(),
  ghlPipelineId: z.string().max(160).optional(),
  ghlStageId: z.string().max(160).optional(),
  active: z.boolean().default(true),
});

const adminCampaignTestCallSchema = z.object({
  toNumber: z.string().min(6),
  leadName: z.string().min(1).max(80).optional(),
});

function serializeGhlCampaign(campaign: {
  id: string;
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
  createdAt?: Date;
  updatedAt?: Date;
}) {
  const normalized = normalizeStoredGhlCampaign(campaign);
  return {
    ...campaign,
    ghlApiKey: undefined,
    ghlApiKeyConfigured: Boolean(campaign.ghlApiKey),
    webhookInstructions: normalized ? buildGhlWebhookInstructions(normalized) : null,
  };
}

function adminRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function adminString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function adminNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function adminDiffSeconds(start?: Date | null, end?: Date | null): number | null {
  if (!start || !end) return null;
  const seconds = Math.round((end.getTime() - start.getTime()) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function adminCsvFilename(campaignId: string): string {
  const safeCampaignId = campaignId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "campaign";
  const dateKey = new Date().toISOString().slice(0, 10);
  return `revenio-${safeCampaignId}-calls-${dateKey}.csv`;
}

function normalizeAdminGhlCampaignData(data: z.infer<typeof adminGhlCampaignSchema>, options: { preserveEmptyApiKey: boolean }) {
  const normalized = {
    ...data,
    clientName: adminString(data.clientName),
    ghlLocationId: adminString(data.ghlLocationId),
    ghlPipelineId: adminString(data.ghlPipelineId),
    ghlStageId: adminString(data.ghlStageId),
    ghlApiKey: adminString(data.ghlApiKey),
  };
  if (options.preserveEmptyApiKey && !normalized.ghlApiKey) {
    delete (normalized as Partial<typeof normalized>).ghlApiKey;
  }
  return normalized;
}

app.get("/lab/settings/call-window", (_req, res) => {
  const settings = getCallWindowSettings();
  const startEval = canStartOutboundCall();
  const failoverEval = canRunRoundRobinFailover();
  return res.json({
    ok: true,
    settings,
    evaluation: {
      startOutbound: startEval,
      roundRobinFailover: failoverEval,
    },
  });
});

app.post("/lab/settings/call-window", async (req, res) => {
  const parsed = callWindowSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  }

  const data = parsed.data;
  const settings = data.reset
    ? resetCallWindowSettings()
    : updateCallWindowSettings({
        enabled: data.enabled,
        timezone: data.timezone,
        startHour: data.startHour,
        endHour: data.endHour,
        activeWeekdays: data.activeWeekdays,
        applyToRoundRobinFailover: data.applyToRoundRobinFailover,
      });

  const startEval = canStartOutboundCall();
  const failoverEval = canRunRoundRobinFailover();
  return res.json({
    ok: true,
    settings,
    evaluation: {
      startOutbound: startEval,
      roundRobinFailover: failoverEval,
    },
  });
});

app.get("/api/admin/ghl-campaigns", async (_req, res) => {
  const campaigns = await prisma.ghlCampaign.findMany({
    orderBy: [{ active: "desc" }, { propertyKey: "asc" }, { name: "asc" }],
  });
  return res.json({ ok: true, campaigns: campaigns.map(serializeGhlCampaign) });
});

app.post("/api/admin/ghl-campaigns", async (req, res) => {
  const parsed = adminGhlCampaignSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  }

  try {
    const campaign = await prisma.ghlCampaign.create({
      data: normalizeAdminGhlCampaignData(parsed.data, { preserveEmptyApiKey: false }),
    });
    return res.status(201).json({ ok: true, campaign: serializeGhlCampaign(campaign) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unique constraint")) {
      return res.status(409).json({ error: "campaign_id_exists", campaignId: parsed.data.campaignId });
    }
    throw error;
  }
});

app.get("/api/admin/ghl-campaigns/:id", async (req, res) => {
  const campaign = await prisma.ghlCampaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).json({ error: "not_found" });
  return res.json({ ok: true, campaign: serializeGhlCampaign(campaign) });
});

app.get("/api/admin/ghl-campaigns/:id/calls.csv", async (req, res) => {
  const campaign = await prisma.ghlCampaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).json({ error: "not_found" });

  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "1000"), 10) || 1000, 1), 5000);
  const attempts = await prisma.callAttempt.findMany({
    where: {
      providerId: { not: null },
      OR: [
        { resultJson: { path: ["ghlIntegration", "campaignId"], equals: campaign.campaignId } },
        { resultJson: { path: ["campaignId"], equals: campaign.campaignId } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { lead: true },
  });

  const callIds = attempts
    .map((attempt) => attempt.providerId)
    .filter((callId): callId is string => Boolean(callId));
  const metrics = callIds.length
    ? await prisma.callMetric.findMany({
        where: { callId: { in: callIds } },
        orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
      })
    : [];
  const metricsByCallId = new Map(metrics.map((metric) => [metric.callId, metric]));

  const rows = attempts.map((attempt) => {
    const result = adminRecord(attempt.resultJson);
    const integration = adminRecord(result?.ghlIntegration);
    const roundRobin = adminRecord(result?.roundRobin);
    const selectedAgent = adminRecord(result?.selected_agent);
    const metric = attempt.providerId ? metricsByCallId.get(attempt.providerId) : null;
    const startedAt = metric?.startedAt ?? attempt.createdAt;
    const transferNumber =
      metric?.transferNumber ??
      adminString(selectedAgent?.transfer_number) ??
      adminString(roundRobin?.selectedTransferNumber) ??
      adminString(result?.transferNumber);
    const durationSec = metric?.durationSec ?? adminNumber(result?.durationSec);
    const timeToTransferSec = adminDiffSeconds(metric?.startedAt, metric?.transferredAt);
    const sellerTalkSec =
      metric?.postTransferDurationSec ??
      adminDiffSeconds(metric?.transferredAt, metric?.endedAt);

    return {
      campaignName: adminString(integration?.campaignName) ?? campaign.name,
      campaignId: adminString(integration?.campaignId) ?? campaign.campaignId,
      startedAt,
      phone: attempt.lead?.phone ?? metric?.phoneNumber ?? "",
      outcome: metric?.outcome ?? attempt.status,
      sentiment: metric?.sentiment ?? "",
      assignedTo: adminString(integration?.assignedTo) ?? adminString(result?.assignedTo) ?? "",
      firstAgentName:
        adminString(roundRobin?.firstAgentName) ??
        adminString(roundRobin?.selectedAgentName) ??
        adminString(selectedAgent?.human_agent_name) ??
        "",
      answeredAgentName: adminString(roundRobin?.answeredAgentName) ?? "",
      transferNumber,
      durationSec,
      timeToTransferSec,
      sellerTalkSec,
      transcript: metric?.fullTranscript ?? metric?.transferTranscript ?? metric?.transcript ?? "",
      recordingUrl: metric?.transferRecordingUrl ?? metric?.recordingUrl ?? "",
    };
  });

  const csv = buildCampaignCallsCsv(rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${adminCsvFilename(campaign.campaignId)}"`);
  return res.send(csv);
});

app.put("/api/admin/ghl-campaigns/:id", async (req, res) => {
  const parsed = adminGhlCampaignSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  }

  try {
    const campaign = await prisma.ghlCampaign.update({
      where: { id: req.params.id },
      data: normalizeAdminGhlCampaignData(parsed.data, { preserveEmptyApiKey: true }),
    });
    return res.json({ ok: true, campaign: serializeGhlCampaign(campaign) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Record to update not found")) {
      return res.status(404).json({ error: "not_found" });
    }
    if (message.includes("Unique constraint")) {
      return res.status(409).json({ error: "campaign_id_exists", campaignId: parsed.data.campaignId });
    }
    throw error;
  }
});

app.post("/api/admin/ghl-campaigns/:id/test-call", async (req, res) => {
  const callWindow = canStartOutboundCall();
  if (!callWindow.allowed) {
    return res.status(400).json({
      error: "outside_business_hours",
      message: "Llamadas fuera de horario habilitado",
      call_window: callWindow,
    });
  }

  const parsed = adminCampaignTestCallSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  }

  const campaign = await prisma.ghlCampaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).json({ error: "campaign_not_found" });
  if (!campaign.active) return res.status(400).json({ error: "campaign_inactive" });
  if (!VAPI_API_KEY) {
    return res.status(400).json({ error: "missing_vapi_config", required: ["VAPI_API_KEY"] });
  }

  const agents = await prisma.ghlHumanAgent.findMany({
    where: { propertyKey: campaign.propertyKey, campaignId: campaign.campaignId },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  const setting = await prisma.ghlAgentPoolSetting.findFirst({
    where: { propertyKey: campaign.propertyKey, campaignId: campaign.campaignId },
    orderBy: { updatedAt: "desc" },
  });
  const transfer = selectCampaignTestTransfer({
    agents,
    fallback: {
      name: setting?.fallbackName,
      ghlUserId: setting?.fallbackGhlUserId,
      transferNumber: setting?.fallbackTransferNumber,
    },
  });
  if (!transfer) {
    return res.status(400).json({
      error: "missing_transfer_config",
      message: "Configura al menos un vendedor activo o fallback final en Admin.",
    });
  }

  const safeName = parsed.data.leadName ? sanitizeName(parsed.data.leadName) : "Lead de prueba";
  const lead = await prisma.lead.create({
    data: {
      name: safeName,
      phone: parsed.data.toNumber,
      source: `admin-test:${campaign.campaignId}`,
      events: {
        create: {
          type: "lead_received",
          detail: { source: `admin-test:${campaign.campaignId}` },
        },
      },
    },
  });

  const attempt = await prisma.callAttempt.create({
    data: {
      leadId: lead.id,
      status: "initiated",
    },
  });

  const configuredAgents = agents
    .filter((agent) => agent.active !== false)
    .slice(0, MAX_ROUND_ROBIN_AGENTS)
    .map((agent) => ({ name: agent.name, transferNumber: agent.transferNumber }));
  const selectedAgentIndex = transfer.source === "agent" ? 0 : configuredAgents.length;
  const assistantOverrides = buildAssistantOverrides(
    safeName,
    lead.id,
    attempt.id,
    transfer.transferNumber,
    transfer.name,
  );
  const payload = {
    phoneNumberId: campaign.vapiPhoneNumberId,
    assistantId: campaign.vapiAssistantId,
    customer: { number: parsed.data.toNumber },
    assistantOverrides,
  };

  let resp: Response;
  let data: any = {};
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    resp = await fetch("https://api.vapi.ai/call/phone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VAPI_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    data = await resp.json().catch(() => ({}));
  } catch (error) {
    await prisma.callAttempt.update({ where: { id: attempt.id }, data: { status: "failed" } });
    return res.status(502).json({
      error: "vapi_network_error",
      message: error instanceof Error ? error.message : String(error),
      lead_id: lead.id,
      attempt_id: attempt.id,
    });
  }

  await prisma.event.create({
    data: {
      leadId: lead.id,
      type: "vapi_call_request",
      detail: {
        request: payload,
        response: data,
        status: resp.status,
        flow: "admin-campaign-test",
        campaign: {
          id: campaign.campaignId,
          name: campaign.name,
          propertyKey: campaign.propertyKey,
        },
        roundRobin: {
          enabled: configuredAgents.length > 0,
          strategy: "sequential_failover",
          selectedAgentIndex,
          selectedAgentName: transfer.name,
          selectedTransferNumber: transfer.transferNumber,
          fallbackAgentName: setting?.fallbackName ?? null,
          fallbackTransferNumber: setting?.fallbackTransferNumber ?? null,
          poolSize: configuredAgents.length,
          agents: buildRoundRobinAgentsSnapshot(configuredAgents),
          fallbackGhlUserId: setting?.fallbackGhlUserId ?? null,
        },
      } as any,
    },
  });

  if (!resp.ok) {
    await prisma.callAttempt.update({ where: { id: attempt.id }, data: { status: "failed" } });
    return res.status(502).json({ error: "vapi_call_failed", status: resp.status, data, lead_id: lead.id, attempt_id: attempt.id });
  }

  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "sent",
      providerId: typeof data.id === "string" ? data.id : null,
      controlUrl: data?.monitor?.controlUrl ?? null,
      resultJson: {
        transferNumber: transfer.transferNumber,
        fallbackTransferNumber: setting?.fallbackTransferNumber ?? null,
        assistantId: campaign.vapiAssistantId,
        ghlIntegration: {
          propertyKey: campaign.propertyKey,
          campaignId: campaign.campaignId,
          campaignName: campaign.name,
        },
        roundRobin: {
          enabled: configuredAgents.length > 0,
          strategy: "sequential_failover",
          selectedAgentIndex,
          selectedAgentName: transfer.name,
          selectedTransferNumber: transfer.transferNumber,
          fallbackAgentName: setting?.fallbackName ?? null,
          fallbackGhlUserId: setting?.fallbackGhlUserId ?? null,
          fallbackTransferNumber: setting?.fallbackTransferNumber ?? null,
          poolSize: configuredAgents.length,
          agents: buildRoundRobinAgentsSnapshot(configuredAgents),
        },
      } as any,
    },
  });
  await linkAttemptWithTwilioParentSid({
    vapiCallId: typeof data.id === "string" ? data.id : null,
    attemptId: attempt.id,
    leadId: lead.id,
    vapiResponse: data,
  });
  await upsertDashboardMetricFromVapiCall({
    data,
    fallbackPhone: parsed.data.toNumber,
    fallbackAssistantId: campaign.vapiAssistantId,
    transferNumber: transfer.transferNumber,
    lastEventType: "call-created",
  });

  return res.json({
    ok: true,
    lead_id: lead.id,
    attempt_id: attempt.id,
    campaign: serializeGhlCampaign(campaign),
    selected_agent: {
      human_agent_name: transfer.name,
      ghl_user_id: transfer.ghlUserId,
      transfer_number: transfer.transferNumber,
      source: transfer.source,
      round_robin_pool_size: configuredAgents.length,
      fallback_transfer_number: setting?.fallbackTransferNumber ?? null,
    },
    vapi: data,
  });
});

async function handleGetGhlAgents(req: express.Request, res: express.Response) {
  const parsed = labGhlAgentScopeSchema.safeParse({
    propertyKey: req.query.propertyKey,
    campaignId: req.query.campaignId || undefined,
  });
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", issues: parsed.error.issues });
  }

  const { propertyKey, campaignId } = parsed.data;
  const agents = await prisma.ghlHumanAgent.findMany({
    where: { propertyKey, campaignId: campaignId ?? null },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  const setting = await prisma.ghlAgentPoolSetting.findFirst({
    where: { propertyKey, campaignId: campaignId ?? null },
    orderBy: { updatedAt: "desc" },
  });

  return res.json({
    ok: true,
    propertyKey,
    campaignId: campaignId ?? null,
    agents,
    fallback: {
      name: setting?.fallbackName ?? "",
      ghlUserId: setting?.fallbackGhlUserId ?? "",
      transferNumber: setting?.fallbackTransferNumber ?? "",
    },
  });
}

async function handlePutGhlAgents(req: express.Request, res: express.Response) {
  const parsed = labGhlAgentsSaveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  }

  const { propertyKey, campaignId, agents, fallback } = parsed.data;
  const fallbackName = fallback?.name?.trim() || null;
  const fallbackGhlUserId = fallback?.ghlUserId?.trim() || null;
  const fallbackTransferNumber = fallback?.transferNumber?.trim() || null;
  const normalizedAgents = agents.map((agent, index) => ({
    propertyKey,
    campaignId: campaignId ?? null,
    name: agent.name.trim(),
    ghlUserId: agent.ghlUserId.trim(),
    transferNumber: agent.transferNumber.trim(),
    priority: agent.priority || index + 1,
    active: agent.active ?? true,
  }));

  const savedAgents = await prisma.$transaction(async (tx) => {
    await tx.ghlHumanAgent.deleteMany({
      where: { propertyKey, campaignId: campaignId ?? null },
    });
    await tx.ghlAgentPoolSetting.deleteMany({
      where: { propertyKey, campaignId: campaignId ?? null },
    });
    for (const agent of normalizedAgents) {
      await tx.ghlHumanAgent.create({ data: agent });
    }
    if (fallbackName || fallbackGhlUserId || fallbackTransferNumber) {
      await tx.ghlAgentPoolSetting.create({
        data: {
          propertyKey,
          campaignId: campaignId ?? null,
          fallbackName,
          fallbackGhlUserId,
          fallbackTransferNumber,
        },
      });
    }
    return tx.ghlHumanAgent.findMany({
      where: { propertyKey, campaignId: campaignId ?? null },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
  });

  return res.json({
    ok: true,
    propertyKey,
    campaignId: campaignId ?? null,
    agents: savedAgents,
    fallback: {
      name: fallbackName ?? "",
      ghlUserId: fallbackGhlUserId ?? "",
      transferNumber: fallbackTransferNumber ?? "",
    },
  });
}

app.get("/lab/ghl-agents", handleGetGhlAgents);
app.put("/lab/ghl-agents", handlePutGhlAgents);
app.get("/api/admin/ghl-agents", handleGetGhlAgents);
app.put("/api/admin/ghl-agents", handlePutGhlAgents);

app.post("/lab/sync-attempt/:id", async (req, res) => {
  const attempt = await prisma.callAttempt.findUnique({
    where: { id: req.params.id },
    include: { lead: true },
  });

  if (!attempt) {
    return res.status(404).json({ error: "attempt_not_found" });
  }
  if (!attempt.providerId) {
    return res.status(400).json({ error: "missing_provider_id" });
  }
  const syncSchema = z.object({
    vapi_api_key: z.string().min(10).optional(),
  });
  const parsed = syncSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  }

  const resolvedVapiApiKey = parsed.data.vapi_api_key ?? VAPI_API_KEY;

  if (!resolvedVapiApiKey) {
    return res.status(400).json({
      error: "missing_vapi_config",
      required: ["VAPI_API_KEY"],
    });
  }

  const resp = await fetch(`https://api.vapi.ai/call/${attempt.providerId}`, {
    headers: {
      Authorization: `Bearer ${resolvedVapiApiKey}`,
    },
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return res.status(502).json({ error: "vapi_call_lookup_failed", status: resp.status, data });
  }

  const transcript =
    (typeof data?.artifact?.transcript === "string" && data.artifact.transcript) ||
    buildTranscriptFromMessages(data?.messages) ||
    null;
  const detail = transcript ? { ...data, transcript } : data;

  await prisma.event.create({
    data: {
      leadId: attempt.leadId,
      type: "vapi_result",
      detail: detail as any,
    },
  });

  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: { resultJson: detail as any },
  });
  await upsertDashboardMetricFromVapiCall({
    data: detail as Record<string, unknown>,
    fallbackPhone: attempt.lead.phone,
    fallbackAssistantId: typeof detail?.assistantId === "string" ? detail.assistantId : null,
    transferNumber: typeof detail?.forwardedPhoneNumber === "string" ? detail.forwardedPhoneNumber : null,
    lastEventType: "lab-sync",
  });

  return res.json({
    ok: true,
    attempt_id: attempt.id,
    provider_id: attempt.providerId,
    transcript_found: Boolean(transcript),
    status: typeof data?.status === "string" ? data.status : null,
    endedReason: typeof data?.endedReason === "string" ? data.endedReason : null,
    endedMessage: typeof data?.endedMessage === "string" ? data.endedMessage : null,
  });
});

app.get("/lab/call-status/:id", async (req, res) => {
  const attempt = await prisma.callAttempt.findUnique({
    where: { id: req.params.id },
  });
  if (!attempt) {
    return res.status(404).json({ error: "attempt_not_found" });
  }
  if (!attempt.providerId) {
    return res.status(400).json({ error: "missing_provider_id" });
  }
  if (!VAPI_API_KEY) {
    return res.status(400).json({
      error: "missing_vapi_config",
      required: ["VAPI_API_KEY"],
    });
  }

  const resp = await fetch(`https://api.vapi.ai/call/${attempt.providerId}`, {
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
    },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return res.status(502).json({ error: "vapi_call_lookup_failed", status: resp.status, data });
  }

  return res.json({
    ok: true,
    attempt_id: attempt.id,
    provider_id: attempt.providerId,
    status: typeof data?.status === "string" ? data.status : null,
    endedReason: typeof data?.endedReason === "string" ? data.endedReason : null,
    endedMessage: typeof data?.endedMessage === "string" ? data.endedMessage : null,
    vapi: data,
  });
});

// ============ TWILIO RECORDING PROXY ============
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? '';

function getTwilioAuth(): string {
  return Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
}

/**
 * Proxy endpoint to serve Twilio recordings without exposing auth credentials
 * GET /api/recordings/:recordingSid
 */
app.get("/api/recordings/:recordingSid", async (req, res) => {
  const { recordingSid } = req.params;
  
  if (!recordingSid || !recordingSid.startsWith('RE')) {
    return res.status(400).json({ error: 'Invalid recording SID' });
  }
  
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return res.status(500).json({ error: 'Twilio credentials not configured' });
  }
  
  const format = req.query.format === 'wav' ? '' : '.mp3';
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}${format}`;
  
  try {
    const response = await fetch(twilioUrl, {
      headers: {
        'Authorization': `Basic ${getTwilioAuth()}`,
      },
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'Failed to fetch recording', 
        status: response.status 
      });
    }
    
    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const contentLength = response.headers.get('content-length');
    
    res.setHeader('Content-Type', contentType);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    
    // Stream the response
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Recording proxy error:', error);
    return res.status(500).json({ error: 'Failed to proxy recording' });
  }
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
