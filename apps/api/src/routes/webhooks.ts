/**
 * Webhook handlers for VAPI call events
 * Captures metrics for the dashboard
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { deriveSentiment, determineOutcome, isAbandonedReason, isNormalEndReason } from '../lib/sentiment.js';

const router = Router();

function looksLikeTransferEndedReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const normalized = reason.toLowerCase();
  return normalized.includes('forward') || normalized.includes('transfer');
}

// Schemas per event type with required fields
const BaseCallSchema = z.object({
  id: z.string(),
  customer: z.object({
    number: z.string().optional(),
  }).optional(),
});

const CallStartedSchema = z.object({
  type: z.literal('call-started'),
  call: BaseCallSchema.extend({
    startedAt: z.string(),
  }),
});

const TransferStartedSchema = z.object({
  type: z.literal('transfer-started'),
  call: BaseCallSchema.extend({
    transferredAt: z.string().optional(),
    startedAt: z.string().optional(),
  }),
});

const CallEndedSchema = z.object({
  type: z.literal('call-ended'),
  call: BaseCallSchema.extend({
    endedAt: z.string(),
    duration: z.number().optional(),
    endedReason: z.string().optional(),
  }),
});

const CallEventSchema = z.discriminatedUnion('type', [
  CallStartedSchema,
  TransferStartedSchema,
  CallEndedSchema,
]);

router.post('/vapi/metrics', async (req, res) => {
  const parsed = CallEventSchema.safeParse(req.body);
  if (!parsed.success) {
    console.log('Invalid webhook payload:', parsed.error.format());
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.format() });
  }
  
  const { type, call } = parsed.data;
  
  // Calculate event timestamp based on event type
  let eventAt: Date;
  switch (type) {
    case 'call-started':
      eventAt = new Date(call.startedAt);
      break;
    case 'transfer-started':
      eventAt = new Date(call.transferredAt || call.startedAt || Date.now());
      break;
    case 'call-ended':
      eventAt = new Date(call.endedAt);
      break;
  }

  // STEP 1: Read existing record (if any)
  const existing = await prisma.callMetric.findUnique({
    where: { callId: call.id },
  });

  // STEP 2: Check idempotency BEFORE writing
  if (existing?.lastEventAt && eventAt <= existing.lastEventAt) {
    console.log('Ignoring out-of-order event:', { type, callId: call.id });
    return res.json({ ok: true, ignored: true, reason: 'out-of-order or duplicate' });
  }

  // STEP 3: Create or update based on event type
  const phoneNumber = call.customer?.number || 'unknown';

  try {
    if (type === 'call-started') {
      await prisma.callMetric.upsert({
        where: { callId: call.id },
        create: {
          callId: call.id,
          phoneNumber,
          startedAt: eventAt,
          inProgress: true,
          outcome: 'in_progress',
          lastEventType: type,
          lastEventAt: eventAt,
        },
        update: {
          startedAt: eventAt,
          inProgress: true,
          outcome: 'in_progress',
          lastEventType: type,
          lastEventAt: eventAt,
        },
      });
      console.log('call-started:', { callId: call.id, phone: phoneNumber });
    }

    if (type === 'transfer-started') {
      await prisma.callMetric.upsert({
        where: { callId: call.id },
        create: {
          callId: call.id,
          phoneNumber,
          transferredAt: eventAt,
          outcome: 'transfer_success',
          sentiment: 'positive',
          lastEventType: type,
          lastEventAt: eventAt,
        },
        update: {
          transferredAt: eventAt,
          outcome: 'transfer_success',
          sentiment: 'positive',
          lastEventType: type,
          lastEventAt: eventAt,
        },
      });
      console.log('transfer-started:', { callId: call.id });
    }

    if (type === 'call-ended') {
      const wasTransferred = existing?.transferredAt != null;
      const endedReason = call.endedReason || null;
      const inferredTransfer = wasTransferred || looksLikeTransferEndedReason(endedReason);
      // Some providers send only "call-ended" without a prior "call-started".
      // Ensure startedAt is populated so summary/daily metrics include the call.
      const startedAtFallback = existing?.startedAt ?? eventAt;
      // If no explicit transfer-started event arrived, infer transfer timestamp from call-ended.
      const transferredAtFallback = existing?.transferredAt ?? (inferredTransfer ? eventAt : null);
      const outcome = determineOutcome(inferredTransfer, endedReason);
      const sentiment = deriveSentiment({
        outcome,
        durationSec: call.duration ?? null,
        endedReason,
      });
      
      await prisma.callMetric.upsert({
        where: { callId: call.id },
        create: {
          callId: call.id,
          phoneNumber,
          startedAt: startedAtFallback,
          transferredAt: transferredAtFallback,
          endedAt: eventAt,
          durationSec: call.duration,
          endedReason,
          inProgress: false,
          outcome,
          sentiment,
          lastEventType: type,
          lastEventAt: eventAt,
        },
        update: {
          startedAt: startedAtFallback,
          transferredAt: transferredAtFallback,
          endedAt: eventAt,
          durationSec: call.duration,
          endedReason,
          inProgress: false,
          outcome,
          sentiment,
          lastEventType: type,
          lastEventAt: eventAt,
        },
      });
      console.log('call-ended:', { callId: call.id, outcome, sentiment });
    }

    return res.json({ ok: true, type, callId: call.id });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal error', message: String(error) });
  }
});

export default router;
