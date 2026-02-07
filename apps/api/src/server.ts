import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { PrismaClient, LeadStatus } from "@prisma/client";

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

app.get("/leads", async (req, res) => {
  const parsed = leadListSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", issues: parsed.error.issues });
  }

  const { page, pageSize, status, from, to, hasAttempts } = parsed.data;
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

  const candidates: Array<Record<string, unknown> | undefined> = [
    p.metadata as Record<string, unknown> | undefined,
    call?.metadata as Record<string, unknown> | undefined,
    msg?.metadata as Record<string, unknown> | undefined,
    msgCall?.metadata as Record<string, unknown> | undefined,
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
  const leadId = extractLeadId(req.body) ?? (req.query.lead_id as string | undefined) ?? null;
  const attemptId = extractAttemptId(req.body);

  console.log("vapi_result", { leadId, attemptId });

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

  const resp = await fetch("https://api.vapi.ai/call/phone", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VAPI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => ({}));

  await prisma.event.create({
    data: {
      leadId: lead.id,
      type: "vapi_call_request",
      detail: { request: payload, response: data, status: resp.status },
    },
  });

  if (!resp.ok) {
    return res.status(502).json({ error: "vapi_call_failed", status: resp.status, data });
  }

  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: { status: "sent", providerId: data?.id ?? null },
  });

  return res.json({ ok: true, attempt_id: attempt.id, vapi: data });
});
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
