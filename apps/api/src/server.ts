import "dotenv/config";
import express from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const app = express();

app.use(express.json({ limit: "1mb" }));

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

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
