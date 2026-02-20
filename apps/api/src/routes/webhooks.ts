/**
 * Webhook handlers for VAPI call events
 * Captures metrics for the dashboard
 */

import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { deriveSentiment, determineOutcome } from '../lib/sentiment.js';

const router = Router();
const DEFAULT_ADVISOR_NUMBER = '+525527326714';

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

type HandlerResult = Record<string, unknown>;

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

async function processMetricsEvent(normalized: NormalizedMetricEvent): Promise<HandlerResult> {
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
    return { ok: true, ignored: true, reason: 'out-of-order or duplicate', callId: call.id };
  }

  // STEP 3: Create or update based on event type
  const phoneNumber = call.customer?.number || 'unknown';

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
  
  return { ok: true, type, callId: call.id };
}

async function processEndOfCallReport(body: unknown): Promise<HandlerResult | null> {
  const root = asRecord(body);
  const message = asRecord(root?.message) || root;
  
  // Verify this is an end-of-call-report
  const eventType = asString(message?.type);
  if (eventType !== 'end-of-call-report') {
    return null;
  }

  const call = asRecord(message?.call);
  const artifact = asRecord(message?.artifact);
  
  if (!call) {
    return { ok: false, error: 'Missing call object' };
  }

  const callId = asString(call.id);
  if (!callId) {
    return { ok: false, error: 'Missing callId' };
  }

  // Extract data from the report
  const endedReason = asString(message?.endedReason) || asString(call.endedReason);
  const duration = asNumber(call.duration) ?? asNumber(call.durationSeconds);
  const cost = asNumber(call.cost);
  const status = asString(call.status);
  const forwardedPhoneNumber =
    asString(call.forwardedPhoneNumber) ||
    asString(message?.forwardedPhoneNumber) ||
    asString(asRecord(message?.destination)?.number);
  
  // Extract transcript from artifact
  const transcript = asString(artifact?.transcript);
  
  // Extract recording URL
  const recording = asRecord(artifact?.recording);
  const recordingUrl = asString(recording?.url) || asString(artifact?.recordingUrl);
  
  // Extract timestamps
  const startedAt = pickTimestamp(call, ['startedAt', 'started_at', 'createdAt']);
  const endedAt = pickTimestamp(call, ['endedAt', 'ended_at']);
  
  console.log('end-of-call-report:', { 
    callId, 
    status,
    endedReason, 
    forwardedPhoneNumber,
    duration, 
    hasTranscript: !!transcript,
    hasRecording: !!recordingUrl 
  });

  // Check if this call was transferred
  const existing = await prisma.callMetric.findUnique({
    where: { callId },
  });
  
  const wasTransferred = existing?.transferredAt != null || looksLikeTransferEndedReason(endedReason ?? null);
  const outcome = determineOutcome(wasTransferred, endedReason ?? null);
  const sentiment = deriveSentiment({
    outcome,
    durationSec: duration ?? null,
    endedReason: endedReason ?? null,
  });

  await prisma.callMetric.upsert({
    where: { callId },
    create: {
      callId,
      phoneNumber: asString(asRecord(call.customer)?.number) || 'unknown',
      startedAt: startedAt ? new Date(startedAt) : undefined,
      endedAt: endedAt ? new Date(endedAt) : new Date(),
      durationSec: duration,
      endedReason,
      outcome,
      sentiment,
      transcript,
      recordingUrl,
      cost: cost !== undefined ? cost : undefined,
      inProgress: false,
      lastEventType: 'end-of-call-report',
      lastEventAt: new Date(),
    },
    update: {
      endedAt: endedAt ? new Date(endedAt) : new Date(),
      durationSec: duration,
      endedReason,
      outcome,
      sentiment,
      transcript,
      recordingUrl,
      cost: cost !== undefined ? cost : undefined,
      inProgress: false,
      lastEventType: 'end-of-call-report',
      lastEventAt: new Date(),
    },
  });

  return { 
    ok: true, 
    callId, 
    outcome, 
    hasTranscript: !!transcript,
    hasRecording: !!recordingUrl,
    durationSec: duration 
  };
}

async function processTransferUpdate(body: unknown): Promise<HandlerResult | null> {
  const root = asRecord(body);
  const message = asRecord(root?.message) || root;
  
  const eventType = asString(message?.type);
  if (eventType !== 'transfer-update' && eventType !== 'transfer-destination-request') {
    return null;
  }

  const call = asRecord(message?.call);
  const callId = asString(call?.id);
  
  if (!callId) {
    return { ok: false, error: 'Missing callId' };
  }

  const destination = asRecord(message?.destination) || asRecord(message?.transferDestination);
  const transferNumber =
    asString(destination?.number) ||
    asString(message?.destinationNumber) ||
    asString(message?.to);
  
  console.log(eventType + ':', { callId, transferNumber });

  if (eventType === 'transfer-destination-request') {
    await prisma.callMetric.upsert({
      where: { callId },
      create: {
        callId,
        phoneNumber: asString(asRecord(call?.customer)?.number) || 'unknown',
        transferredAt: new Date(),
        outcome: 'transfer_success',
        sentiment: 'positive',
        lastEventType: eventType,
        lastEventAt: new Date(),
      },
      update: {
        transferredAt: new Date(),
        outcome: 'transfer_success',
        sentiment: 'positive',
        lastEventType: eventType,
        lastEventAt: new Date(),
      },
    });

    const controlUrl = asString(asRecord(asRecord(message?.call)?.monitor)?.controlUrl);

    console.log('controlUrl:', controlUrl);

    if (controlUrl) {
      console.log('Executing transfer via controlUrl...');
      const response = await fetch(`${controlUrl}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'transfer',
          destination: { type: 'number', number: '+525527326714' }
        }),
      });
      console.log('Control response:', response.status);
    }

    return { success: true };
  }

  await prisma.callMetric.upsert({
    where: { callId },
    create: {
      callId,
      phoneNumber: asString(asRecord(call?.customer)?.number) || 'unknown',
      transferredAt: new Date(),
      outcome: 'transfer_success',
      sentiment: 'positive',
      lastEventType: eventType,
      lastEventAt: new Date(),
    },
    update: {
      transferredAt: new Date(),
      outcome: 'transfer_success',
      sentiment: 'positive',
      lastEventType: eventType,
      lastEventAt: new Date(),
    },
  });

  return { ok: true, callId, transferred: true, destination: transferNumber, eventType };
}

router.post('/vapi/metrics', async (req, res) => {
  try {
    const endOfCall = await processEndOfCallReport(req.body);
    if (endOfCall) {
      if (endOfCall.ok === false) return res.status(400).json(endOfCall);
      return res.json({ ...endOfCall, via: 'end-of-call-report' });
    }

    const transfer = await processTransferUpdate(req.body);
    if (transfer) {
      if (asRecord(transfer)?.ok === false) return res.status(400).json(transfer);
      if (asRecord(transfer)?.destination) return res.json(transfer);
      return res.json({ ...transfer, via: 'transfer-update' });
    }

    const normalized = normalizeMetricsEvent(req.body);
    if (normalized) {
      const metrics = await processMetricsEvent(normalized);
      return res.json({ ...metrics, via: 'metrics' });
    }

    const rootKeys = Object.keys(asRecord(req.body) ?? {});
    return res.json({ ok: true, ignored: true, reason: 'unsupported_event', rootKeys });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal error', message: String(error) });
  }
});

/**
 * Dedicated handler for end-of-call-report events
 * Captures transcript, recording URL, cost, and final call details
 */
router.post('/vapi/end-of-call', async (req, res) => {
  try {
    const result = await processEndOfCallReport(req.body);
    if (!result) return res.json({ ok: true, ignored: true, reason: 'not end-of-call-report' });
    if (result.ok === false) return res.status(400).json(result);
    return res.json(result);
  } catch (error) {
    console.error('End-of-call webhook error:', error);
    return res.status(500).json({ error: 'Internal error', message: String(error) });
  }
});

/**
 * Handler for transfer-update / transfer-destination-request events
 * Captures when a transfer is initiated
 */
router.post('/vapi/transfer', async (req, res) => {
  try {
    const result = await processTransferUpdate(req.body);
    if (!result) return res.json({ ok: true, ignored: true, reason: 'not transfer event' });
    if (asRecord(result)?.ok === false) return res.status(400).json(result);
    return res.json(result);
  } catch (error) {
    console.error('Transfer webhook error:', error);
    return res.status(500).json({ error: 'Internal error', message: String(error) });
  }
});

/**
 * Unified Vapi events endpoint.
 * Accepts end-of-call-report, transfer-update, transfer-destination-request and metrics-compatible payloads.
 */
router.post('/vapi/events', async (req, res) => {
  try {
    const endOfCall = await processEndOfCallReport(req.body);
    if (endOfCall) {
      if (endOfCall.ok === false) return res.status(400).json(endOfCall);
      return res.json({ ...endOfCall, via: 'end-of-call-report' });
    }

    const transfer = await processTransferUpdate(req.body);
    if (transfer) {
      if (asRecord(transfer)?.ok === false) return res.status(400).json(transfer);
      if (asRecord(transfer)?.destination) return res.json(transfer);
      return res.json({ ...transfer, via: 'transfer-update' });
    }

    const normalized = normalizeMetricsEvent(req.body);
    if (normalized) {
      const metrics = await processMetricsEvent(normalized);
      return res.json({ ...metrics, via: 'metrics' });
    }

    const rootKeys = Object.keys(asRecord(req.body) ?? {});
    return res.json({ ok: true, ignored: true, reason: 'unsupported_event', rootKeys });
  } catch (error) {
    console.error('Unified webhook error:', error);
    return res.status(500).json({ error: 'Internal error', message: String(error) });
  }
});

export default router;
