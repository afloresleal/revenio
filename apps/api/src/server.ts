import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { Prisma, PrismaClient, LeadStatus } from "@prisma/client";

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

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
  status: z.nativeEnum(LeadStatus).optional(),
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

  const { page, pageSize, status, from, to, hasAttempts } = parsed.data as LeadListQuery;
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

app.post("/webhooks/twilio/status", async (req, res) => {
  const leadId = extractLeadId(req.body) ?? (req.query.lead_id as string | undefined) ?? null;
  const status = (req.body?.CallStatus as string | undefined) ?? "unknown";
  const providerId = (req.body?.CallSid as string | undefined) ?? null;

  console.log("twilio_status", { leadId, status, providerId });

  if (leadId) {
    await prisma.event.create({
      data: {
        leadId,
        type: "twilio_status",
        detail: { status, providerId, raw: req.body },
      },
    });
  }

  res.status(200).send("ok");
});

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

  if (leadId) {
    await prisma.event.create({
      data: {
        leadId,
        type: "vapi_result",
        detail: req.body ?? {},
      },
    });
  }

  if (attemptId) {
    await prisma.callAttempt.update({
      where: { id: attemptId },
      data: { resultJson: req.body ?? {} },
    });
  }

  res.status(200).json({ ok: true });
});

const port = Number(process.env.PORT ?? 3000);

const VAPI_API_KEY = process.env.VAPI_API_KEY ?? "";
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID ?? "";
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID ?? "";

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
      detail: { request: payload, response: data, status: resp.status } as Prisma.InputJsonValue,
    },
  });

  if (!resp.ok) {
    return res.status(502).json({ error: "vapi_call_failed", status: resp.status, data });
  }

  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: { status: "sent", providerId: typeof data.id === "string" ? data.id : null },
  });

  return res.json({ ok: true, attempt_id: attempt.id, vapi: data });
});

const callDirectSchema = z.object({
  vapi_api_key: z.string().min(10).optional(),
  vapi_phone_number_id: z.string().min(6).optional(),
  vapi_assistant_id: z.string().min(6).optional(),
  to_number: z.string().min(6),
  lead_id: z.string().uuid().optional(),
  lead_name: z.string().min(1).optional(),
  lead_source: z.string().min(1).optional(),
});

app.post("/call/test/direct", async (req, res) => {
  const parsed = callDirectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  }

  const { vapi_api_key, vapi_phone_number_id, vapi_assistant_id, to_number, lead_id, lead_name, lead_source } =
    parsed.data;
  const resolvedVapiApiKey = vapi_api_key ?? VAPI_API_KEY;
  const resolvedVapiPhoneNumberId = vapi_phone_number_id ?? VAPI_PHONE_NUMBER_ID;
  const resolvedVapiAssistantId = vapi_assistant_id ?? VAPI_ASSISTANT_ID;

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
            name: lead_name ?? "Test",
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

  const payload = {
    phoneNumberId: resolvedVapiPhoneNumberId,
    assistantId: resolvedVapiAssistantId,
    customer: { number: to_number },
    metadata: { lead_id: lead.id, attempt_id: attempt.id },
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
      detail: { request: payload, response: data, status: resp.status } as Prisma.InputJsonValue,
    },
  });

  if (!resp.ok) {
    return res.status(502).json({ error: "vapi_call_failed", status: resp.status, data });
  }

  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: { status: "sent", providerId: typeof data.id === "string" ? data.id : null },
  });

  return res.json({ ok: true, attempt_id: attempt.id, vapi: data });
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

  const transcript =
    (typeof data?.artifact?.transcript === "string" && data.artifact.transcript) ||
    buildTranscriptFromMessages(data?.messages) ||
    null;
  const detail = transcript ? { ...data, transcript } : data;

  await prisma.event.create({
    data: {
      leadId: attempt.leadId,
      type: "vapi_result",
      detail: detail as Prisma.InputJsonValue,
    },
  });

  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: { resultJson: detail as Prisma.InputJsonValue },
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

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
