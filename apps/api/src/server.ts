import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

// Import route modules
import metricsRouter from "./routes/metrics.js";
import webhooksRouter from "./routes/webhooks.js";
import jobsRouter from "./routes/jobs.js";

const prisma = new PrismaClient();
const app = express();
const FAILOVER_RING_TIMEOUT_SEC = Math.max(1, Number(process.env.TRANSFER_FAILOVER_RING_TIMEOUT_SEC ?? 5));
const FAILOVER_FAILURE_STATUSES = new Set(["no-answer", "busy", "failed", "canceled"]);
const FAILOVER_CLEAR_TIMER_STATUSES = new Set([
  "in-progress",
  "completed",
  "no-answer",
  "busy",
  "failed",
  "canceled",
]);
const failoverTimers = new Map<string, NodeJS.Timeout>();

// CORS configuration for dashboard
app.use(cors({
  origin: [
    'http://localhost:3001',
    'http://localhost:5173',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5173',
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

async function executeFailoverToNextAgent(params: {
  attemptId: string;
  leadId?: string | null;
  currentChildCallSid?: string | null;
  reason: "ring-timeout" | "status-failed";
}) {
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
  if (agents.length <= 1) return { ok: false, reason: "insufficient_pool" as const };

  const currentIndex = asFiniteInteger(rr.selectedAgentIndex) ?? 0;
  const nextIndex = currentIndex + 1;
  if (nextIndex >= agents.length) {
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
          nextIndex,
          nextTransferNumber: nextAgent.transferNumber,
          nextAgentName: nextAgent.name,
        } as any,
      },
    });
  }

  return {
    ok: true,
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

async function handleTwilioStatusWebhook(req: express.Request, res: express.Response) {
  const status = asNonEmptyString(req.body?.CallStatus) ?? "unknown";
  const callDurationSec = parseInteger(req.body?.CallDuration);
  const normalizedStatus = status.toLowerCase();
  const context = await resolveTwilioContext(req.body, req.query as Record<string, unknown>);
  const isChildLeg = typeof context.parentCallSid === "string" && context.parentCallSid.startsWith("CA");

  console.log("twilio_status", {
    leadId: context.leadId,
    attemptId: context.attemptId,
    status,
    callSid: context.callSid,
    parentCallSid: context.parentCallSid,
    vapiCallId: context.vapiCallId,
    callDurationSec,
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

  if (context.vapiCallId) {
    await prisma.callMetric.updateMany({
      where: { callId: context.vapiCallId },
      data: {
        twilioParentCallSid: context.parentSid ?? undefined,
        twilioTransferCallSid: isChildLeg ? context.callSid ?? undefined : undefined,
        transferStatus: isChildLeg ? normalizedStatus : undefined,
      },
    });
  }

  const isCompleted = normalizedStatus === "completed";
  const hasPositiveDuration = Number.isFinite(callDurationSec) && (callDurationSec ?? 0) > 0;
  if (context.vapiCallId && isChildLeg && isCompleted && hasPositiveDuration) {
    await prisma.callMetric.updateMany({
      where: {
        callId: context.vapiCallId,
        OR: [
          { postTransferDurationSec: null },
          { postTransferDurationSec: { lt: callDurationSec as number } },
        ],
      },
      data: { postTransferDurationSec: callDurationSec as number },
    });
  }

  if (isChildLeg && context.attemptId && context.callSid) {
    const timerKey = `${context.attemptId}:${context.callSid}`;
    if (normalizedStatus === "ringing") {
      scheduleRingTimeoutFailover({
        attemptId: context.attemptId,
        leadId: context.leadId,
        childCallSid: context.callSid,
      });
    }
    if (FAILOVER_CLEAR_TIMER_STATUSES.has(normalizedStatus)) {
      clearFailoverTimer(timerKey);
    }
    if (FAILOVER_FAILURE_STATUSES.has(normalizedStatus)) {
      try {
        const failoverResult = await executeFailoverToNextAgent({
          attemptId: context.attemptId,
          leadId: context.leadId,
          currentChildCallSid: context.callSid,
          reason: "status-failed",
        });
        console.log("transfer_failover_status_failed", {
          attemptId: context.attemptId,
          childCallSid: context.callSid,
          status: normalizedStatus,
          failoverResult,
        });
      } catch (error) {
        console.error("transfer_failover_status_failed_error", {
          attemptId: context.attemptId,
          childCallSid: context.callSid,
          status: normalizedStatus,
          error: String(error),
        });
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
          isChildLeg,
          raw: req.body,
        },
      },
    });
  }
  res.status(200).send("ok");
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
const TRANSFER_NUMBER = process.env.TRANSFER_NUMBER ?? "+525527326714";

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

/** Transfer messages by language */
const TRANSFER_MESSAGES: Record<'es' | 'en', string> = {
  es: "Habla Marina de Casalba, asistente virtual. Nos dejaste tus datos sobre propiedades en Los Cabos. Un asesor lo atenderá de manera personal, por favor deme unos segundos que le estoy transfiriendo su llamada.",
  en: "This is a virtual assistant with Caribbean Luxury Homes. We received your request about Riviera Maya properties. Please hold while I connect you with a property specialist."
};

/** System prompts by language - Default prompts (specific agent prompts configured in VAPI dashboard) */
const SYSTEM_PROMPTS: Record<'es' | 'en', string> = {
  es: "Eres Marina de Casalba. Cuando el usuario responda, ejecuta transferCall inmediatamente. No digas nada, solo ejecuta el tool.",
  en: "You are a virtual assistant from Caribbean Luxury Homes. When the user responds affirmatively, execute transferCall immediately. Do not generate any additional message after initiating the transfer."
};

// ============ BUSINESS HOURS HELPERS ============

/** Get current hour in CST (America/Mexico_City) */
function getCSTHour(): number {
  const now = new Date();
  const cstTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  return cstTime.getHours();
}

/** Check if current time is within business hours (7am - 10pm CST) */
function isWithinBusinessHours(): boolean {
  const hour = getCSTHour();
  return hour >= 7 && hour < 22; // 7:00 AM - 9:59 PM
}

/** Get dynamic greeting based on time of day (Spanish only - legacy) */
function getGreeting(): string {
  const hour = getCSTHour();
  if (hour >= 7 && hour < 12) return "Hola, buenos días.";
  if (hour >= 12 && hour < 18) return "Hola, buenas tardes.";
  return "Hola, linda noche.";
}

/** Get dynamic greeting based on time of day and language */
function getGreetingByLanguage(language: 'es' | 'en'): string {
  const hour = getCSTHour();
  
  if (language === 'en') {
    if (hour >= 5 && hour < 12) return "Hello, good morning.";
    if (hour >= 12 && hour < 18) return "Hello, good afternoon.";
    return "Hello, good evening.";
  }
  
  // Spanish (default)
  if (hour >= 7 && hour < 12) return "Hola, buenos días.";
  if (hour >= 12 && hour < 18) return "Hola, buenas tardes.";
  return "Hola, linda noche.";
}

/** Get first message based on name and language
 * Note: Specific agent first messages (Brenda/Bella) are configured directly in VAPI dashboard.
 * This function provides fallback/default messages when assistantOverrides are used.
 */
function getFirstMessage(name: string | null | undefined, language: 'es' | 'en'): string {
  const safeName = name?.trim();
  
  if (safeName && safeName.length > 0) {
    return language === 'en' 
      ? `Hi ${safeName} — we just received your request for information about Riviera Maya properties. This is a virtual assistant with Caribbean Luxury Homes.`
      : `Hola, ¿hablo con ${safeName}?`;
  }
  
  return getGreetingByLanguage(language);
}

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

/** Build assistantOverrides for VAPI call based on whether we have a name and language
 * 
 * IMPORTANT (2026-03-04): Do NOT send firstMessage in overrides when we have a name.
 * The assistant's firstMessage in VAPI dashboard uses {{name}} interpolation.
 * Sending firstMessage here would override the assistant's configured script.
 * See: MB-FIX-01 in #julia-codigo
 */
function buildAssistantOverrides(
  safeName: string | null,
  leadId: string,
  attemptId: string,
  transferNumber: string,
  language: 'es' | 'en' = 'es'
): Record<string, unknown> {
  if (safeName) {
    // WITH name: pass variableValues for {{name}} interpolation
    // firstMessage comes from the assistant config in VAPI dashboard
    return {
      variableValues: { name: safeName },
      metadata: { lead_id: leadId, attempt_id: attemptId },
    };
  } else {
    // WITHOUT name: dynamic greeting based on time, override model for immediate transfer
    return {
      firstMessage: getGreetingByLanguage(language),
      metadata: { lead_id: leadId, attempt_id: attemptId },
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [{
          role: "system",
          content: SYSTEM_PROMPTS[language]
        }],
        tools: [{
          type: "transferCall",
          messages: [{
            type: "request-start",
            content: TRANSFER_MESSAGES[language],
            blocking: true
          }],
          destinations: [{
            type: "number",
            number: transferNumber
          }]
        }]
      }
    };
  }
}

app.post("/call/test/direct", async (req, res) => {
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
  const defaultTransferNumber = transfer_number ?? TRANSFER_NUMBER;
  const safeName = lead_name ? sanitizeName(lead_name) : null;
  const requestAgents = getRoundRobinHumanAgentsFromRequest(round_robin_agents);
  const envAgents = getRoundRobinHumanAgentsFromEnv(defaultTransferNumber);
  const configuredRoundRobinAgents = requestAgents.length ? requestAgents : envAgents;
  const roundRobinRequested = round_robin_enabled === true || requestAgents.length > 0;
  const shouldUseRoundRobin = roundRobinRequested && configuredRoundRobinAgents.length > 0;
  let selectedTransferNumber = defaultTransferNumber;
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
  const assistantOverrides = buildAssistantOverrides(safeName, lead.id, attempt.id, selectedTransferNumber, language);
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
        greeting: getFirstMessage(safeName, language),
        language,
        roundRobin: shouldUseRoundRobin
          ? {
              enabled: true,
              strategy: "sequential_failover",
              selectedAgentIndex,
              selectedAgentName,
              selectedTransferNumber,
              poolSize: configuredRoundRobinAgents.length,
              agents: buildRoundRobinAgentsSnapshot(configuredRoundRobinAgents),
            }
          : { enabled: false },
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
        roundRobin: shouldUseRoundRobin
          ? {
              enabled: true,
              strategy: "sequential_failover",
              selectedAgentIndex,
              selectedAgentName,
              selectedTransferNumber,
              poolSize: configuredRoundRobinAgents.length,
              agents: buildRoundRobinAgentsSnapshot(configuredRoundRobinAgents),
            }
          : { enabled: false },
      } as any,
    },
  });

  return res.json({ 
    ok: true, 
    attempt_id: attempt.id,
    lead_id: lead.id,
    flow: safeName ? "with_name" : "without_name",
    greeting: getFirstMessage(safeName, language),
    language,
    selected_agent: {
      assistant_id: resolvedVapiAssistantId,
      human_agent_name: selectedAgentName,
      transfer_number: selectedTransferNumber,
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

function getRoundRobinHumanAgentsFromEnv(defaultTransferNumber: string): RoundRobinHumanAgent[] {
  const transferNumbers = parseCsvList(process.env.HUMAN_AGENT_NUMBERS || process.env.TRANSFER_NUMBERS)
    .slice(0, MAX_ROUND_ROBIN_AGENTS);
  const names = parseCsvList(process.env.HUMAN_AGENT_NAMES);
  if (!transferNumbers.length) return [];
  return transferNumbers.map((transferNumber, index) => ({
    transferNumber: transferNumber || defaultTransferNumber,
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
  if (!isWithinBusinessHours()) {
    const hour = getCSTHour();
    return res.status(400).json({
      error: 'outside_business_hours',
      message: 'Llamadas solo permitidas de 7:00 AM a 10:00 PM CST',
      current_hour_cst: hour
    });
  }

  const parsed = callVapiSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  }

  const { to_number, transfer_number, lead_name, lead_id, lead_source, round_robin_enabled, round_robin_agents } = parsed.data;
  const defaultTransferNumber = transfer_number ?? TRANSFER_NUMBER;
  const safeName = lead_name ? sanitizeName(lead_name) : null;
  const requestAgents = getRoundRobinHumanAgentsFromRequest(round_robin_agents);
  const envAgents = getRoundRobinHumanAgentsFromEnv(defaultTransferNumber);
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

  let selectedTransferNumber = defaultTransferNumber;
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
  const assistantOverrides = buildAssistantOverrides(safeName, lead.id, attempt.id, selectedTransferNumber, language);
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
        greeting: getFirstMessage(safeName, language),
        language,
        roundRobin: shouldUseRoundRobin
          ? {
              enabled: true,
              strategy: "sequential_failover",
              selectedAgentIndex,
              selectedAgentName,
              selectedTransferNumber,
              poolSize: configuredRoundRobinAgents.length,
              agents: buildRoundRobinAgentsSnapshot(configuredRoundRobinAgents),
            }
          : { enabled: false },
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
        assistantId: selectedAssistantId,
        roundRobin: shouldUseRoundRobin
          ? {
              enabled: true,
              strategy: "sequential_failover",
              selectedAgentIndex,
              selectedAgentName,
              selectedTransferNumber,
              poolSize: configuredRoundRobinAgents.length,
              agents: buildRoundRobinAgentsSnapshot(configuredRoundRobinAgents),
            }
          : { enabled: false },
      } as any,
    },
  });

  return res.json({ 
    ok: true, 
    attempt_id: attempt.id, 
    lead_id: lead.id,
    flow: safeName ? "with_name" : "without_name",
    greeting: getFirstMessage(safeName, language),
    language,
    selected_agent: {
      assistant_id: selectedAssistantId,
      human_agent_name: selectedAgentName,
      transfer_number: selectedTransferNumber,
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

app.post("/lab/sync-attempt/:id", async (req, res) => {
  const attempt = await prisma.callAttempt.findUnique({
    where: { id: req.params.id },
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
