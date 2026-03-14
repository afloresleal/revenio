/**
 * Webhook handlers for VAPI call events
 * Captures metrics for the dashboard
 */

import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { deriveSentiment, determineOutcome } from '../lib/sentiment.js';

const router = Router();

const DEFAULT_ADVISOR_NUMBER = process.env.TRANSFER_NUMBER ?? '+525527326714';
const BRENDA_ASSISTANT_ID = '5ac0c5dd-2e79-4d29-b76a-add2ff1b93b7';
const VAPI_API_KEY = process.env.VAPI_API_KEY ?? '';

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
    assistantId?: string;
    transferNumber?: string;
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

function extractAssistantId(call: Record<string, unknown>, message?: Record<string, unknown> | null): string | undefined {
  return (
    asString(call.assistantId) ||
    asString(asRecord(call.assistant)?.id) ||
    asString(asRecord(message?.assistant)?.id)
  );
}

function extractTransferNumber(call: Record<string, unknown>, message?: Record<string, unknown> | null): string | undefined {
  return (
    asString(call.forwardedPhoneNumber) ||
    asString(call.transferNumber) ||
    asString(asRecord(call.destination)?.number) ||
    asString(message?.forwardedPhoneNumber) ||
    asString(asRecord(message?.destination)?.number) ||
    asString(asRecord(message?.transferDestination)?.number)
  );
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
  const assistantId = extractAssistantId(call, message);
  const transferNumber = extractTransferNumber(call, message);
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
      assistantId,
      transferNumber,
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
        assistantId: call.assistantId,
        transferNumber: call.transferNumber,
        startedAt: eventAt,
        inProgress: true,
        outcome: 'in_progress',
        lastEventType: type,
        lastEventAt: eventAt,
      },
      update: {
        assistantId: call.assistantId,
        transferNumber: call.transferNumber,
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
        assistantId: call.assistantId,
        transferNumber: call.transferNumber,
        transferredAt: eventAt,
        outcome: 'transfer_success',
        sentiment: 'positive',
        lastEventType: type,
        lastEventAt: eventAt,
      },
      update: {
        assistantId: call.assistantId,
        transferNumber: call.transferNumber,
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
    const startedAtFromPayload = call.startedAt ? new Date(call.startedAt) : null;
    const transferredAtFromPayload = call.transferredAt ? new Date(call.transferredAt) : null;
    const startedAtFallback =
      startedAtFromPayload && !isNaN(startedAtFromPayload.getTime())
        ? startedAtFromPayload
        : (existing?.startedAt ?? eventAt);
    // If no explicit transfer-started event arrived, infer transfer timestamp from payload/call-ended.
    const transferredAtFallback =
      existing?.transferredAt ??
      (transferredAtFromPayload && !isNaN(transferredAtFromPayload.getTime()) ? transferredAtFromPayload : null) ??
      (inferredTransfer ? eventAt : null);
    let durationSec = typeof call.duration === 'number' && call.duration > 0 ? call.duration : null;
    if (durationSec === null) {
      const inferred = Math.round((eventAt.getTime() - startedAtFallback.getTime()) / 1000);
      if (inferred > 0) durationSec = inferred;
    }
    const outcome = determineOutcome(inferredTransfer, endedReason);
    const sentiment = deriveSentiment({
      outcome,
      durationSec,
      endedReason,
    });
    
    await prisma.callMetric.upsert({
      where: { callId: call.id },
      create: {
        callId: call.id,
        phoneNumber,
        assistantId: call.assistantId ?? existing?.assistantId ?? null,
        transferNumber: call.transferNumber ?? existing?.transferNumber ?? null,
        startedAt: startedAtFallback,
        transferredAt: transferredAtFallback,
        endedAt: eventAt,
        durationSec,
        endedReason,
        inProgress: false,
        outcome,
        sentiment,
        lastEventType: type,
        lastEventAt: eventAt,
      },
      update: {
        assistantId: call.assistantId ?? existing?.assistantId ?? null,
        transferNumber: call.transferNumber ?? existing?.transferNumber ?? null,
        startedAt: startedAtFallback,
        transferredAt: transferredAtFallback,
        endedAt: eventAt,
        durationSec: durationSec ?? existing?.durationSec ?? null,
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
  
  // Debug: Log raw call object structure
  console.log('end-of-call-report raw call keys:', Object.keys(asRecord(message?.call) || {}));

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
  const assistantId = extractAssistantId(call, message);
  
  // Extract transcript from artifact
  const transcript = asString(artifact?.transcript);
  
  // Extract recording URL
  const recording = asRecord(artifact?.recording);
  const recordingUrl = asString(recording?.url) || asString(artifact?.recordingUrl);
  
  // Extract timestamps
  // VAPI sends createdAt/updatedAt, not startedAt/endedAt
  const startedAt = pickTimestamp(call, ['startedAt', 'started_at', 'createdAt']);
  const endedAt = pickTimestamp(call, ['endedAt', 'ended_at', 'updatedAt', 'updated_at']);
  const ingestAt = new Date();
  
  // Calculate duration from timestamps if not provided
  let calculatedDuration = duration;
  if ((calculatedDuration === undefined || calculatedDuration <= 0) && startedAt && endedAt) {
    const startMs = new Date(startedAt).getTime();
    const endMs = new Date(endedAt).getTime();
    if (!isNaN(startMs) && !isNaN(endMs)) {
      const diffSec = Math.round((endMs - startMs) / 1000);
      if (diffSec > 0) {
        calculatedDuration = diffSec;
      }
    }
  }
  
  console.log('end-of-call-report:', { 
    callId, 
    status,
    endedReason, 
    forwardedPhoneNumber,
    duration: calculatedDuration, 
    startedAt,
    endedAt,
    hasTranscript: !!transcript,
    hasRecording: !!recordingUrl 
  });

  // Debug: Check if endedReason indicates transfer
  const endedReasonIndicatesTransfer = looksLikeTransferEndedReason(endedReason ?? null);
  console.log('end-of-call-report debug:', {
    callId,
    endedReason,
    endedReasonIndicatesTransfer,
  });

  // Check if this call was transferred
  const existing = await prisma.callMetric.findUnique({
    where: { callId },
  });
  const startedAtDate = (() => {
    if (startedAt) {
      const parsed = new Date(startedAt);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return existing?.startedAt ?? null;
  })();
  let endedAtDate = (() => {
    if (endedAt) {
      const parsed = new Date(endedAt);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return ingestAt;
  })();
  if (startedAtDate && endedAtDate.getTime() <= startedAtDate.getTime() && ingestAt.getTime() > startedAtDate.getTime()) {
    endedAtDate = ingestAt;
  }
  
  const hadTransferredAt = existing?.transferredAt != null;
  const endedReasonHasTransfer = looksLikeTransferEndedReason(endedReason ?? null);
  const wasTransferred = hadTransferredAt || endedReasonHasTransfer;
  const outcome = determineOutcome(wasTransferred, endedReason ?? null);
  
  console.log('end-of-call-report outcome decision:', {
    callId,
    hadTransferredAt,
    existingTransferredAt: existing?.transferredAt,
    endedReason,
    endedReasonHasTransfer,
    wasTransferred,
    outcome,
  });
  const sentiment = deriveSentiment({
    outcome,
    durationSec: duration ?? null,
    endedReason: endedReason ?? null,
  });

  const finalDuration =
    calculatedDuration && calculatedDuration > 0
      ? calculatedDuration
      : startedAtDate
        ? Math.max(0, Math.round((endedAtDate.getTime() - startedAtDate.getTime()) / 1000))
        : null;

  await prisma.callMetric.upsert({
    where: { callId },
    create: {
      callId,
      phoneNumber: asString(asRecord(call.customer)?.number) || 'unknown',
      assistantId,
      transferNumber: forwardedPhoneNumber ?? existing?.transferNumber ?? null,
      startedAt: startedAtDate ?? undefined,
      endedAt: endedAtDate,
      durationSec: finalDuration,
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
      startedAt: startedAtDate ?? undefined,
      endedAt: endedAtDate,
      assistantId,
      transferNumber: forwardedPhoneNumber ?? existing?.transferNumber ?? null,
      durationSec: finalDuration ?? existing?.durationSec ?? null,
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
  const assistantId = extractAssistantId(call ?? {}, message);
  
  console.log(eventType + ':', { callId, transferNumber });

  // For transfer-destination-request: VAPI expects us to RESPOND with the destination
  // NO POST to controlUrl needed - just return the destination in the response
  if (eventType === 'transfer-destination-request') {
    console.log('Responding with transfer destination:', DEFAULT_ADVISOR_NUMBER);
    
    // Update DB to mark transfer initiated
    await prisma.callMetric.upsert({
      where: { callId },
      create: {
        callId,
        phoneNumber: asString(asRecord(call?.customer)?.number) || 'unknown',
        assistantId,
        transferNumber: transferNumber ?? DEFAULT_ADVISOR_NUMBER,
        transferredAt: new Date(),
        outcome: 'transfer_success',
        sentiment: 'positive',
        lastEventType: eventType,
        lastEventAt: new Date(),
      },
      update: {
        assistantId,
        transferNumber: transferNumber ?? DEFAULT_ADVISOR_NUMBER,
        transferredAt: new Date(),
        outcome: 'transfer_success',
        sentiment: 'positive',
        lastEventType: eventType,
        lastEventAt: new Date(),
      },
    });

    // Return the destination - this tells VAPI where to transfer
    return {
      destination: {
        type: 'number',
        number: DEFAULT_ADVISOR_NUMBER,
      },
    };
  }

  // For transfer-update: just log and update DB
  await prisma.callMetric.upsert({
    where: { callId },
    create: {
      callId,
      phoneNumber: asString(asRecord(call?.customer)?.number) || 'unknown',
      assistantId,
      transferNumber: transferNumber ?? DEFAULT_ADVISOR_NUMBER,
      transferredAt: new Date(),
      outcome: 'transfer_success',
      sentiment: 'positive',
      lastEventType: eventType,
      lastEventAt: new Date(),
    },
    update: {
      assistantId,
      transferNumber: transferNumber ?? DEFAULT_ADVISOR_NUMBER,
      transferredAt: new Date(),
      outcome: 'transfer_success',
      sentiment: 'positive',
      lastEventType: eventType,
      lastEventAt: new Date(),
    },
  });

  return { ok: true, callId, transferred: true, destination: transferNumber, eventType };
}

/**
 * Auto-transfer handler for Brenda
 * Triggers transfer after first assistant message (turn 1)
 */
async function processSpeechUpdate(body: unknown): Promise<HandlerResult | null> {
  const root = asRecord(body);
  const message = asRecord(root?.message) || root;
  
  if (asString(message?.type) !== 'speech-update') return null;
  
  const status = asString(message?.status);
  const role = asString(message?.role);
  const turn = asNumber(message?.turn);
  const call = asRecord(message?.call);
  const assistantId = asString(call?.assistantId);
  const callId = asString(call?.id);
  const callMetadata = asRecord(call?.metadata);
  const transferNumberFromCall =
    asString(callMetadata?.transfer_number) ??
    asString(callMetadata?.transferNumber);
  
  console.log('speech-update:', { status, role, turn, assistantId, callId });
  
  // Auto-transfer conditions (ONLY for Brenda):
  // 1. Assistant finished speaking (status === 'stopped')
  // 2. It's the assistant speaking (role === 'assistant')
  // 3. First turn (Vapi may count from 0 or 1)
  // 4. It's Brenda specifically (assistantId check)
  if (
    status === 'stopped' && 
    role === 'assistant' && 
    (turn === 0 || turn === 1) && 
    assistantId === BRENDA_ASSISTANT_ID
  ) {
    console.log('Auto-transfer triggered for Brenda:', callId);
    
    // Find controlUrl in DB
    let controlUrl: string | null = null;
    let transferNumber = transferNumberFromCall ?? DEFAULT_ADVISOR_NUMBER;
    
    try {
      const attempt = await prisma.callAttempt.findFirst({
        where: { providerId: callId },
        orderBy: { createdAt: 'desc' }
      });
      
      controlUrl = attempt?.controlUrl ?? null;
      const attemptResult = asRecord(attempt?.resultJson);
      transferNumber =
        asString(attemptResult?.transferNumber) ??
        asString(attemptResult?.transfer_number) ??
        transferNumber;
      
      // Fallback: get from VAPI API if not in DB
      if (!controlUrl && callId && VAPI_API_KEY) {
        const callData = await fetch(`https://api.vapi.ai/call/${callId}`, {
          headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` }
        }).then(r => r.json()).catch(() => null);
        controlUrl = callData?.monitor?.controlUrl ?? null;
      }
      
      if (!controlUrl) {
        console.error('No controlUrl available for auto-transfer:', callId);
        return { ok: false, error: 'no_control_url', callId };
      }
      
      // Execute transfer
      const transferResp = await fetch(controlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'transfer',
          destination: { type: 'number', number: transferNumber }
        })
      });

      console.log('Auto-transfer destination:', transferNumber);
      console.log('Auto-transfer response:', transferResp.status);
      if (!transferResp.ok) {
        const transferBody = await transferResp.text().catch(() => '');
        console.error('Auto-transfer response body:', transferBody);
      }
      
      // Update attempt status
      if (attempt) {
        await prisma.callAttempt.update({
          where: { id: attempt.id },
          data: { status: 'auto-transferred' }
        });
      }
      
      return { ok: true, action: 'auto-transfer', callId, transferStatus: transferResp.status };
    } catch (e) {
      console.error('Auto-transfer failed:', e);
      return { ok: false, error: 'transfer_failed', callId, message: String(e) };
    }
  }
  
  return { ok: true, ignored: true, reason: 'conditions-not-met' };
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
      // If it has destination, return it directly (for transfer-destination-request)
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
    // Auto-transfer for Brenda (speech-update handler)
    const speechUpdate = await processSpeechUpdate(req.body);
    if (speechUpdate) {
      if (speechUpdate.ok === false) return res.status(400).json(speechUpdate);
      if (asRecord(speechUpdate)?.action === 'auto-transfer') {
        return res.json({ ...speechUpdate, via: 'speech-update-auto-transfer' });
      }
      // If ignored, continue processing other event types
    }

    const endOfCall = await processEndOfCallReport(req.body);
    if (endOfCall) {
      if (endOfCall.ok === false) return res.status(400).json(endOfCall);
      return res.json({ ...endOfCall, via: 'end-of-call-report' });
    }

    const transfer = await processTransferUpdate(req.body);
    if (transfer) {
      if (asRecord(transfer)?.ok === false) return res.status(400).json(transfer);
      // If it has destination, return it directly (for transfer-destination-request)
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
