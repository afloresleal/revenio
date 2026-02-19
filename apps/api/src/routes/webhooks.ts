/**
 * Webhook handlers for VAPI call events
 * Captures metrics for the dashboard
 */

import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { deriveSentiment, determineOutcome } from '../lib/sentiment.js';

const router = Router();

function looksLikeTransferEndedReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const normalized = reason.toLowerCase();
  return normalized.includes('forward') || normalized.includes('transfer');
}

type MetricEventType = 'call-started' | 'transfer-started' | 'call-ended';
type NormalizedMetricEvent = {
  type: MetricEventType;
  call: {
    id: string;
    customer?: { number?: string };
    startedAt?: string;
    transferredAt?: string;
    endedAt?: string;
    duration?: number;
    endedReason?: string | null;
    status?: string;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function pickTimestamp(rec: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString(rec[key]);
    if (value) return value;
  }
  return undefined;
}

function normalizeMetricsEvent(body: unknown): NormalizedMetricEvent | null {
  const root = asRecord(body);
  if (!root) return null;

  const message = asRecord(root.message);
  const data = asRecord(root.data);

  const call =
    asRecord(root.call) ||
    asRecord(message?.call) ||
    asRecord(data?.call) ||
    asRecord(asRecord(message?.data)?.call);

  if (!call) return null;

  const callId =
    asString(call.id) ||
    asString(asRecord(call.message)?.id) ||
    asString(root.callId) ||
    asString(message?.callId);

  if (!callId) return null;

  const customer = asRecord(call.customer);
  const status = (asString(call.status) || '').toLowerCase();
  const endedReason = asString(call.endedReason) || asString(call.ended_reason) || null;

  const startedAt = pickTimestamp(call, ['startedAt', 'started_at', 'createdAt', 'created_at']);
  const transferredAt = pickTimestamp(call, ['transferredAt', 'transferred_at']);
  const endedAt = pickTimestamp(call, ['endedAt', 'ended_at', 'updatedAt', 'updated_at']);
  const duration = asNumber(call.duration) ?? asNumber(call.durationSec) ?? asNumber(call.duration_sec);

  const incomingType =
    asString(root.type) ||
    asString(message?.type) ||
    asString(root.event) ||
    asString(message?.event);

  let normalizedType: MetricEventType | null = null;
  if (incomingType === 'call-started' || incomingType === 'transfer-started' || incomingType === 'call-ended') {
    normalizedType = incomingType;
  } else if (endedAt || endedReason || status === 'ended') {
    normalizedType = 'call-ended';
  } else if (transferredAt || looksLikeTransferEndedReason(endedReason) || status.includes('forward') || status.includes('transfer')) {
    normalizedType = 'transfer-started';
  } else if (startedAt || status === 'in-progress' || status === 'queued' || status === 'ringing') {
    normalizedType = 'call-started';
  }

  if (!normalizedType) return null;

  return {
    type: normalizedType,
    call: {
      id: callId,
      customer: { number: asString(customer?.number) },
      startedAt,
      transferredAt,
      endedAt,
      duration,
      endedReason,
      status,
    },
  };
}

router.post('/vapi/metrics', async (req, res) => {
  const normalized = normalizeMetricsEvent(req.body);
  if (!normalized) {
    const rootKeys = Object.keys(asRecord(req.body) ?? {});
    console.log('Invalid webhook payload:', { rootKeys, body: req.body });
    return res.status(400).json({ error: 'Invalid payload', rootKeys });
  }
  
  const { type, call } = normalized;
  
  // Calculate event timestamp based on event type
  let eventAt: Date;
  switch (type) {
    case 'call-started':
      eventAt = new Date(call.startedAt || Date.now());
      break;
    case 'transfer-started':
      eventAt = new Date(call.transferredAt || call.startedAt || Date.now());
      break;
    case 'call-ended':
      eventAt = new Date(call.endedAt || Date.now());
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
