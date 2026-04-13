/**
 * Webhook handlers for VAPI call events
 * Captures metrics for the dashboard
 */

import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { deriveSentiment, determineOutcome } from '../lib/sentiment.js';
import { canTranscribeRecording, composeFullTranscript, transcribeRecordingFromUrl } from '../lib/transcription.js';
import { startRecordingOnChildCalls, getRecordingForCall } from '../lib/twilio-recording.js';

const router = Router();

const DEFAULT_ADVISOR_NUMBER = process.env.TRANSFER_NUMBER ?? '+525527326714';
const BRENDA_ASSISTANT_ID = '5ac0c5dd-2e79-4d29-b76a-add2ff1b93b7';
const BRENDA_TRANSFER_TRIGGER_STATUS =
  (process.env.BRENDA_TRANSFER_TRIGGER_STATUS ?? 'stopped').toLowerCase() === 'started'
    ? 'started'
    : 'stopped';
const FAILOVER_RING_TIMEOUT_SEC = Math.max(1, Number(process.env.TRANSFER_FAILOVER_RING_TIMEOUT_SEC ?? 15));
const TRANSFER_CONNECTED_MIN_SEC = Number(process.env.TRANSFER_CONNECTED_MIN_SEC ?? 10);
const TRANSFER_CONNECTED_STATUSES = new Set(['in-progress', 'answered', 'completed']);
const VAPI_API_KEY = process.env.VAPI_API_KEY ?? '';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? '';

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

function buildTranscriptFromMessages(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  const lines = messages
    .map((m) => {
      if (!m || typeof m !== 'object') return null;
      const msg = m as Record<string, unknown>;
      const role = asString(msg.role);
      const text = asString(msg.message);
      if (!text) return null;
      if (!role) return text;
      if (role === 'assistant') return `AI: ${text}`;
      if (role === 'user') return `User: ${text}`;
      return `${role}: ${text}`;
    })
    .filter((x): x is string => !!x);
  return lines.length ? lines.join('\n') : null;
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

function extractTwilioCallSid(call: Record<string, unknown>, message?: Record<string, unknown> | null): string | undefined {
  const candidates: unknown[] = [
    call.phoneCallProviderId,
    call.providerCallSid,
    call.callSid,
    call.sid,
    asRecord(call.phoneCallTransport)?.providerCallSid,
    asRecord(call.phoneCallTransport)?.callSid,
    asRecord(message)?.phoneCallProviderId,
    asRecord(message)?.providerCallSid,
  ];
  for (const value of candidates) {
    const asStr = asString(value);
    if (asStr && asStr.startsWith('CA')) return asStr;
  }
  return undefined;
}

function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const keepPlus = value.trim().startsWith('+');
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return null;
  return keepPlus ? `+${digits}` : digits;
}

async function fetchTwilioPostTransferDuration(
  parentCallSid: string,
  transferNumber: string | null | undefined,
): Promise<{ durationSec: number | null; childCallSid: string | null; childStatus: string | null; transferNumber: string | null; startedAt: Date | null }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return { durationSec: null, childCallSid: null, childStatus: null, transferNumber: null, startedAt: null };
  }

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const url = new URL(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`);
  url.searchParams.set('ParentCallSid', parentCallSid);
  url.searchParams.set('PageSize', '50');

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.warn('Twilio child call lookup failed:', { status: resp.status, body });
    return { durationSec: null, childCallSid: null, childStatus: null, transferNumber: null, startedAt: null };
  }

  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  const calls = Array.isArray(data.calls) ? (data.calls as Array<Record<string, unknown>>) : [];
  if (calls.length === 0) return { durationSec: null, childCallSid: null, childStatus: null, transferNumber: null, startedAt: null };

  const normalizedTransfer = normalizePhone(transferNumber);
  const candidates = calls
    .map((c) => {
      const to = asString(c.to) ?? '';
      const normalizedTo = normalizePhone(to);
      const durationRaw = asString(c.duration);
      const durationSec = durationRaw ? Number.parseInt(durationRaw, 10) : NaN;
      const startTime = asString(c.start_time) ?? '';
      const sid = asString(c.sid) ?? '';
      const status = asString(c.status) ?? '';
      const score = (normalizedTransfer && normalizedTo && normalizedTo === normalizedTransfer ? 10 : 0)
        + (Number.isFinite(durationSec) && durationSec >= 0 ? 3 : 0)
        + (status === 'completed' ? 1 : 0);
      const startedAt = startTime ? new Date(startTime) : null;
      return {
        sid,
        status,
        score,
        durationSec: Number.isFinite(durationSec) ? durationSec : null,
        startTime,
        startedAt: startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt : null,
        transferNumber: to || null,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.startTime.localeCompare(a.startTime);
    });

  const best = candidates[0];
  if (!best) return { durationSec: null, childCallSid: null, childStatus: null, transferNumber: null, startedAt: null };
  return {
    durationSec: best.durationSec,
    childCallSid: best.sid || null,
    childStatus: best.status || null,
    transferNumber: best.transferNumber,
    startedAt: best.startedAt,
  };
}

async function fetchTwilioCallDuration(callSid: string): Promise<number | null> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !callSid) return null;

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${encodeURIComponent(callSid)}.json`;

  const resp = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.warn('Twilio call duration lookup failed:', { status: resp.status, callSid, body });
    return null;
  }

  const call = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  const durationRaw = asString(call.duration);
  if (!durationRaw) return null;
  const durationSec = Number.parseInt(durationRaw, 10);
  return Number.isFinite(durationSec) && durationSec >= 0 ? durationSec : null;
}

async function fetchVapiTwilioParentSid(callId: string): Promise<string | null> {
  if (!VAPI_API_KEY || !callId) return null;

  try {
    const resp = await fetch(`https://api.vapi.ai/call/${encodeURIComponent(callId)}`, {
      headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
    });
    if (!resp.ok) return null;
    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    const sid = asString(data.phoneCallProviderId);
    return sid && sid.startsWith('CA') ? sid : null;
  } catch {
    return null;
  }
}

function parseRoundRobinAgents(resultJson: Record<string, unknown> | null): Array<{ name: string | null; transferNumber: string }> {
  if (!resultJson) return [];
  const rr = asRecord(resultJson.roundRobin);
  if (!rr || !Array.isArray(rr.agents)) return [];
  return rr.agents
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => !!item)
    .map((item) => ({
      name: asString(item.name) ?? null,
      transferNumber: asString(item.transferNumber) ?? asString(item.transfer_number) ?? '',
    }))
    .filter((a) => !!a.transferNumber);
}

function asFiniteInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function looksLikeInactiveCallError(body: string): boolean {
  const normalized = body.toLowerCase();
  return (
    normalized.includes('not active') ||
    normalized.includes('not in-progress') ||
    normalized.includes('cannot redirect')
  );
}

function buildFirstAgentOutcomePatch(params: {
  rr: Record<string, unknown>;
  currentIndex: number;
  currentAgent: { name: string | null; transferNumber: string } | null;
  result: string;
}) {
  if (params.currentIndex !== 0) return {};
  if (asString(params.rr.firstAgentResult)) return {};
  return {
    firstAgentIndex: 0,
    firstAgentName: params.currentAgent?.name ?? null,
    firstAgentNumber: params.currentAgent?.transferNumber ?? null,
    firstAgentResult: params.result,
    firstAgentOutcomeAt: new Date().toISOString(),
  };
}

async function triggerRoundRobinFailoverFromCallId(params: {
  callId: string;
  reason: string;
  currentChildCallSid?: string | null;
  parentCallSid?: string | null;
}) {
  const attempt = await prisma.callAttempt.findFirst({
    where: { providerId: params.callId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, leadId: true, resultJson: true },
  });
  if (!attempt) return { ok: false, reason: 'missing_attempt' as const };

  const result = asRecord(attempt.resultJson) ?? {};
  const rr = asRecord(result.roundRobin);
  if (!rr || rr.enabled !== true) return { ok: false, reason: 'round_robin_disabled' as const };

  const agents = parseRoundRobinAgents(result);
  if (agents.length <= 1) return { ok: false, reason: 'insufficient_pool' as const };

  const currentIndex = asFiniteInt(rr.selectedAgentIndex) ?? 0;
  const currentAgent = agents[currentIndex] ?? null;
  const nextIndex = currentIndex + 1;
  if (nextIndex >= agents.length) {
    await prisma.callAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'transfer-failover-exhausted',
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
    return { ok: false, reason: 'pool_exhausted' as const };
  }

  const nextAgent = agents[nextIndex];
  const metric = await prisma.callMetric.findUnique({
    where: { callId: params.callId },
    select: { twilioParentCallSid: true },
  });
  const parentSid =
    asString(params.parentCallSid) ??
    asString(metric?.twilioParentCallSid) ??
    (await fetchVapiTwilioParentSid(params.callId));
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return { ok: false, reason: 'missing_twilio_credentials' as const };
  }
  if (!parentSid) {
    return { ok: false, reason: 'missing_parent_sid' as const };
  }

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const callbackQs = new URLSearchParams();
  callbackQs.set('attempt_id', attempt.id);
  callbackQs.set('vapi_call_id', params.callId);
  if (attempt.leadId) callbackQs.set('lead_id', attempt.leadId);
  const callbackUrl = `${process.env.PUBLIC_API_BASE_URL || process.env.API_BASE_URL || 'https://revenioapi-production.up.railway.app'}/webhooks/twilio/transfer-status?${callbackQs.toString()}`;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="${FAILOVER_RING_TIMEOUT_SEC}" action="${callbackUrl}" method="POST"><Number statusCallback="${callbackUrl}" statusCallbackMethod="POST" statusCallbackEvent="initiated ringing answered completed busy no-answer failed canceled" machineDetection="DetectMessageEnd" amdStatusCallback="${callbackUrl}" amdStatusCallbackMethod="POST">${nextAgent.transferNumber}</Number></Dial></Response>`;
  const twilioResp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${encodeURIComponent(parentSid)}.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ Twiml: twiml }).toString(),
    },
  );

  if (!twilioResp.ok) {
    const twilioBody = await twilioResp.text().catch(() => '');
    if (looksLikeInactiveCallError(twilioBody)) {
      return {
        ok: false,
        reason: 'parent_not_active' as const,
        status: twilioResp.status,
      };
    }
    return {
      ok: false,
      reason: 'transfer_command_failed' as const,
      status: twilioResp.status,
      body: twilioBody,
    };
  }
  console.log('RR failover Twilio redirect succeeded:', {
    callId: params.callId,
    attemptId: attempt.id,
    parentSid,
    nextTransferNumber: nextAgent.transferNumber,
  });

  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: {
      status: 'auto-transferred-failover',
      resultJson: {
        ...result,
        transferNumber: nextAgent.transferNumber,
        roundRobin: {
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
        },
      } as any,
    },
  });

  if (attempt.leadId) {
    await prisma.event.create({
      data: {
        leadId: attempt.leadId,
        type: 'transfer_failover',
        detail: {
          attemptId: attempt.id,
          callId: params.callId,
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

async function triggerInitialTwilioTransferFromCallId(params: {
  callId: string;
  reason: string;
  parentCallSid?: string | null;
}) {
  const attempt = await prisma.callAttempt.findFirst({
    where: { providerId: params.callId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, leadId: true, resultJson: true },
  });
  if (!attempt) return { ok: false, reason: 'missing_attempt' as const };

  const result = asRecord(attempt.resultJson) ?? {};
  const rr = asRecord(result.roundRobin);
  const agents = parseRoundRobinAgents(result);
  if (!rr || rr.enabled !== true || agents.length === 0) {
    return { ok: false, reason: 'round_robin_disabled' as const };
  }

  const currentIndex = Math.max(0, asFiniteInt(rr.selectedAgentIndex) ?? 0);
  const currentAgent = agents[currentIndex] ?? agents[0];
  if (!currentAgent) return { ok: false, reason: 'insufficient_pool' as const };

  const metric = await prisma.callMetric.findUnique({
    where: { callId: params.callId },
    select: { twilioParentCallSid: true },
  });
  const parentSid =
    asString(params.parentCallSid) ??
    asString(metric?.twilioParentCallSid) ??
    (await fetchVapiTwilioParentSid(params.callId));

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return { ok: false, reason: 'missing_twilio_credentials' as const };
  }
  if (!parentSid) return { ok: false, reason: 'missing_parent_sid' as const };

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const callbackQs = new URLSearchParams();
  callbackQs.set('attempt_id', attempt.id);
  callbackQs.set('vapi_call_id', params.callId);
  if (attempt.leadId) callbackQs.set('lead_id', attempt.leadId);
  const callbackUrl = `${process.env.PUBLIC_API_BASE_URL || process.env.API_BASE_URL || 'https://revenioapi-production.up.railway.app'}/webhooks/twilio/transfer-status?${callbackQs.toString()}`;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="${FAILOVER_RING_TIMEOUT_SEC}" action="${callbackUrl}" method="POST"><Number statusCallback="${callbackUrl}" statusCallbackMethod="POST" statusCallbackEvent="initiated ringing answered completed busy no-answer failed canceled" machineDetection="DetectMessageEnd" amdStatusCallback="${callbackUrl}" amdStatusCallbackMethod="POST">${currentAgent.transferNumber}</Number></Dial></Response>`;
  const twilioResp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${encodeURIComponent(parentSid)}.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ Twiml: twiml }).toString(),
    },
  );
  if (!twilioResp.ok) {
    const body = await twilioResp.text().catch(() => '');
    if (looksLikeInactiveCallError(body)) {
      return { ok: false, reason: 'parent_not_active' as const, status: twilioResp.status };
    }
    return { ok: false, reason: 'transfer_command_failed' as const, status: twilioResp.status, body };
  }

  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: {
      status: 'auto-transferred',
      resultJson: {
        ...result,
        transferNumber: currentAgent.transferNumber,
        roundRobin: {
          ...rr,
          selectedAgentIndex: currentIndex,
          selectedAgentName: currentAgent.name,
          selectedTransferNumber: currentAgent.transferNumber,
          lastFailoverReason: params.reason,
          lastEscalatedAt: new Date().toISOString(),
        },
      } as any,
    },
  });

  console.log('Initial Twilio transfer redirect succeeded:', {
    callId: params.callId,
    attemptId: attempt.id,
    parentSid,
    transferNumber: currentAgent.transferNumber,
    selectedAgentIndex: currentIndex,
  });

  return {
    ok: true,
    callId: params.callId,
    attemptId: attempt.id,
    parentSid,
    transferNumber: currentAgent.transferNumber,
    selectedAgentIndex: currentIndex,
    selectedAgentName: currentAgent.name,
  };
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
        inProgress: true,
        outcome: 'in_progress',
        sentiment: 'neutral',
        lastEventType: type,
        lastEventAt: eventAt,
      },
      update: {
        assistantId: call.assistantId,
        transferNumber: call.transferNumber,
        transferredAt: eventAt,
        inProgress: true,
        outcome: 'in_progress',
        sentiment: 'neutral',
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
  const twilioParentCallSidFromPayload = extractTwilioCallSid(call, message);
  const assistantId = extractAssistantId(call, message);
  
  // Extract transcript from artifact; fallback to message arrays when explicit transcript is missing.
  const transcript =
    asString(artifact?.transcript) ||
    asString(message?.transcript) ||
    buildTranscriptFromMessages(message?.messages) ||
    buildTranscriptFromMessages(artifact?.messages) ||
    buildTranscriptFromMessages(call.messages) ||
    null;
  
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
  const transferAttempted = hadTransferredAt || endedReasonHasTransfer;
  let outcome = determineOutcome(transferAttempted, endedReason ?? null);
  
  console.log('end-of-call-report outcome decision:', {
    callId,
    hadTransferredAt,
    existingTransferredAt: existing?.transferredAt,
    endedReason,
    endedReasonHasTransfer,
    transferAttempted,
    outcome,
  });
  let sentiment = deriveSentiment({
    outcome,
    durationSec: duration ?? null,
    endedReason: endedReason ?? null,
  });
  let postTransferDurationSec: number | null = null;
  let twilioTransferCallSidFromLookup: string | null = null;
  let transferStatusFromLookup: string | null = null;
  let transferNumberFromTwilio: string | null = null;
  let transferredAtFromTwilio: Date | null = null;
  let twilioTotalDurationSec: number | null = null;
  const twilioParentCallSid = twilioParentCallSidFromPayload ?? await fetchVapiTwilioParentSid(callId);
  if (twilioParentCallSid) {
    const attempt = await prisma.callAttempt.findFirst({
      where: { providerId: callId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, leadId: true },
    });
    await prisma.twilioCallLink.upsert({
      where: { parentCallSid: twilioParentCallSid },
      create: {
        parentCallSid: twilioParentCallSid,
        vapiCallId: callId,
        attemptId: attempt?.id ?? null,
        leadId: attempt?.leadId ?? null,
        lastCallbackAt: new Date(),
      },
      update: {
        vapiCallId: callId,
        attemptId: attempt?.id ?? undefined,
        leadId: attempt?.leadId ?? undefined,
        lastCallbackAt: new Date(),
      },
    });
  }
  if (transferAttempted && twilioParentCallSid) {
    try {
      twilioTotalDurationSec = await fetchTwilioCallDuration(twilioParentCallSid);
      const transferLookup = await fetchTwilioPostTransferDuration(twilioParentCallSid, forwardedPhoneNumber);
      if (transferLookup.durationSec !== null && transferLookup.durationSec >= 0) {
        postTransferDurationSec = transferLookup.durationSec;
      }
      twilioTransferCallSidFromLookup = transferLookup.childCallSid;
      transferStatusFromLookup = transferLookup.childStatus;
      transferNumberFromTwilio = transferLookup.transferNumber;
      transferredAtFromTwilio = transferLookup.startedAt;
    } catch (error) {
      console.warn('Twilio transfer duration lookup error:', {
        callId,
        twilioParentCallSid,
        error: String(error),
      });
    }
  } else if (twilioParentCallSid) {
    try {
      twilioTotalDurationSec = await fetchTwilioCallDuration(twilioParentCallSid);
    } catch (error) {
      console.warn('Twilio total duration lookup error:', {
        callId,
        twilioParentCallSid,
        error: String(error),
      });
    }
  }
  const resolvedTransferNumber = forwardedPhoneNumber ?? transferNumberFromTwilio ?? existing?.transferNumber ?? null;
  const resolvedTransferredAt = existing?.transferredAt ?? transferredAtFromTwilio ?? null;
  let generatedFullTranscript: string | null = existing?.fullTranscript ?? null;
  if (recordingUrl && canTranscribeRecording()) {
    try {
      const generated = await transcribeRecordingFromUrl(recordingUrl);
      generatedFullTranscript = generated.text;
      console.log('end-of-call-report full transcript generated:', {
        callId,
        hasFullTranscript: !!generatedFullTranscript,
        source: generated.source,
      });
    } catch (error) {
      console.warn('end-of-call-report full transcription failed:', { callId, error: String(error) });
    }
  }
  const fallbackCombinedTranscript = composeFullTranscript(
    transcript ?? existing?.transcript ?? null,
    existing?.transferTranscript ?? null,
  );
  const fullTranscript = generatedFullTranscript ?? fallbackCombinedTranscript;

  let finalDuration =
    calculatedDuration && calculatedDuration > 0
      ? calculatedDuration
      : startedAtDate
        ? Math.max(0, Math.round((endedAtDate.getTime() - startedAtDate.getTime()) / 1000))
        : null;
  if (twilioTotalDurationSec !== null && twilioTotalDurationSec > 0) {
    finalDuration = Math.max(finalDuration ?? 0, twilioTotalDurationSec);
  }
  if (startedAtDate && finalDuration !== null && finalDuration > 0) {
    const candidateEnd = new Date(startedAtDate.getTime() + finalDuration * 1000);
    if (candidateEnd.getTime() > endedAtDate.getTime()) endedAtDate = candidateEnd;
  }
  const transferDurationFromTimestamps =
    resolvedTransferredAt && endedAtDate
      ? Math.max(0, Math.round((endedAtDate.getTime() - resolvedTransferredAt.getTime()) / 1000))
      : null;
  const effectivePostTransferDurationSec =
    postTransferDurationSec ??
    existing?.postTransferDurationSec ??
    transferDurationFromTimestamps;
  const effectiveTransferStatus = transferStatusFromLookup ?? existing?.transferStatus ?? null;
  const hasTwilioTransferEvidence = Boolean(
    effectiveTransferStatus && TRANSFER_CONNECTED_STATUSES.has(effectiveTransferStatus),
  );
  const hasDurationEvidence = (effectivePostTransferDurationSec ?? 0) >= TRANSFER_CONNECTED_MIN_SEC;
  const confirmedTransfer = hasTwilioTransferEvidence || hasDurationEvidence;
  outcome = determineOutcome(confirmedTransfer, endedReason ?? null);
  sentiment = deriveSentiment({
    outcome,
    durationSec: finalDuration ?? null,
    endedReason: endedReason ?? null,
  });

  await prisma.callMetric.upsert({
    where: { callId },
    create: {
      callId,
      phoneNumber: asString(asRecord(call.customer)?.number) || 'unknown',
      assistantId,
      transferNumber: resolvedTransferNumber,
      twilioParentCallSid: twilioParentCallSid ?? undefined,
      twilioTransferCallSid: twilioTransferCallSidFromLookup ?? existing?.twilioTransferCallSid ?? undefined,
      transferStatus: transferStatusFromLookup ?? existing?.transferStatus ?? undefined,
      transferredAt: resolvedTransferredAt ?? undefined,
      startedAt: startedAtDate ?? undefined,
      endedAt: endedAtDate,
      durationSec: finalDuration,
      endedReason,
      outcome,
      sentiment,
      transcript,
      fullTranscript: fullTranscript ?? undefined,
      recordingUrl,
      cost: cost !== undefined ? cost : undefined,
      postTransferDurationSec: postTransferDurationSec ?? undefined,
      inProgress: false,
      lastEventType: 'end-of-call-report',
      lastEventAt: new Date(),
    },
    update: {
      startedAt: startedAtDate ?? undefined,
      endedAt: endedAtDate,
      assistantId,
      transferNumber: resolvedTransferNumber,
      twilioParentCallSid: twilioParentCallSid ?? existing?.twilioParentCallSid ?? undefined,
      twilioTransferCallSid: twilioTransferCallSidFromLookup ?? existing?.twilioTransferCallSid ?? undefined,
      transferStatus: transferStatusFromLookup ?? existing?.transferStatus ?? undefined,
      transferredAt: resolvedTransferredAt ?? undefined,
      durationSec: finalDuration ?? existing?.durationSec ?? null,
      endedReason,
      outcome,
      sentiment,
      transcript,
      fullTranscript: fullTranscript ?? existing?.fullTranscript ?? undefined,
      recordingUrl,
      cost: cost !== undefined ? cost : undefined,
      postTransferDurationSec: postTransferDurationSec ?? existing?.postTransferDurationSec ?? undefined,
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
    durationSec: duration,
    postTransferDurationSec,
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
  const attempt = await prisma.callAttempt.findFirst({
    where: { providerId: callId },
    orderBy: { createdAt: 'desc' },
    select: { resultJson: true },
  });
  const attemptResult = asRecord(attempt?.resultJson);
  const attemptRoundRobin = asRecord(attemptResult?.roundRobin);
  const resolvedTransferNumber =
    asString(attemptResult?.transferNumber) ??
    asString(attemptResult?.transfer_number) ??
    asString(attemptRoundRobin?.selectedTransferNumber) ??
    transferNumber ??
    DEFAULT_ADVISOR_NUMBER;
  const assistantId = extractAssistantId(call ?? {}, message);
  
  console.log(eventType + ':', { callId, transferNumber });

  // For transfer-destination-request, default behavior keeps Vapi happy by returning destination.
  // IMPORTANT: always return destination directly to Vapi for initial transfer.
  // Do not trigger Twilio-first here; it can cause app-level transfer errors.
  if (eventType === 'transfer-destination-request') {
    // Update DB to mark transfer initiated
    await prisma.callMetric.upsert({
      where: { callId },
      create: {
        callId,
        phoneNumber: asString(asRecord(call?.customer)?.number) || 'unknown',
        assistantId,
        transferNumber: resolvedTransferNumber,
        transferredAt: new Date(),
        inProgress: true,
        outcome: 'in_progress',
        sentiment: 'neutral',
        lastEventType: eventType,
        lastEventAt: new Date(),
      },
      update: {
        assistantId,
        transferNumber: resolvedTransferNumber,
        transferredAt: new Date(),
        inProgress: true,
        outcome: 'in_progress',
        sentiment: 'neutral',
        lastEventType: eventType,
        lastEventAt: new Date(),
      },
    });
    console.log('Responding with transfer destination:', resolvedTransferNumber, { callId });
    return {
      destination: {
        type: 'number',
        number: resolvedTransferNumber,
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
      transferNumber: resolvedTransferNumber,
      transferredAt: new Date(),
      inProgress: true,
      outcome: 'in_progress',
      sentiment: 'neutral',
      lastEventType: eventType,
      lastEventAt: new Date(),
    },
    update: {
      assistantId,
      transferNumber: resolvedTransferNumber,
      transferredAt: new Date(),
      inProgress: true,
      outcome: 'in_progress',
      sentiment: 'neutral',
      lastEventType: eventType,
      lastEventAt: new Date(),
    },
  });

  return { ok: true, callId, transferred: true, destination: resolvedTransferNumber, eventType };
}

/**
 * Status update handler - activates recording on child calls when transfer starts
 */
async function processStatusUpdate(body: unknown): Promise<HandlerResult | null> {
  const root = asRecord(body);
  const message = asRecord(root?.message) || root;
  
  const eventType = asString(message?.type);
  if (eventType !== 'status-update') return null;
  
  const status = asString(message?.status);
  const call = asRecord(message?.call);
  const callId = asString(call?.id);
  const twilioCallSid = extractTwilioCallSid(call ?? {}, message);
  
  console.log('status-update received:', { status, callId, twilioCallSid, eventType });

  if (status === 'ended' && callId && !twilioCallSid) {
    try {
      const failoverResult = await triggerRoundRobinFailoverFromCallId({
        callId,
        reason: 'child-ended-status-update',
        currentChildCallSid: null,
        parentCallSid: twilioCallSid ?? null,
      });
      console.log('Round robin failover from ended status-update:', { callId, failoverResult });
      if (asRecord(failoverResult)?.ok === true) {
        return { ok: true, action: 'failover-from-ended-status', callId, failoverResult };
      }
    } catch (err) {
      console.error('Round robin failover from ended status-update failed:', {
        callId,
        error: String(err),
      });
    }
  }
  if (status === 'ended' && callId && twilioCallSid) {
    console.log('Skipping ended-status failover because parent Twilio SID is present:', {
      callId,
      twilioCallSid,
    });
  }
  
  // When call is forwarding, try to start recording on the child call
  if (status === 'forwarding' && twilioCallSid) {
    console.log('Transfer in progress, attempting to start recording on child call:', { callId, twilioCallSid });
    
    // startRecordingOnChildCalls has built-in retry logic
    const { childCallSid, recordingSid, error } = await startRecordingOnChildCalls(twilioCallSid);
    
    if (recordingSid) {
      // Store the recording info in the database
      await prisma.callMetric.upsert({
        where: { callId: callId ?? '' },
        create: {
          callId: callId ?? '',
          phoneNumber: 'unknown',
          twilioParentCallSid: twilioCallSid,
          twilioTransferCallSid: childCallSid,
          transferredAt: new Date(),
          lastEventType: 'status-update-forwarding',
          lastEventAt: new Date(),
        },
        update: {
          twilioParentCallSid: twilioCallSid,
          twilioTransferCallSid: childCallSid,
          transferredAt: new Date(),
          lastEventType: 'status-update-forwarding',
          lastEventAt: new Date(),
        },
      });
      
      return { 
        ok: true, 
        action: 'recording-started', 
        callId, 
        twilioCallSid, 
        childCallSid, 
        recordingSid 
      };
    }
    
    console.log('Could not start recording on child call:', { callId, error });
    if ((error === 'no_in_progress_child_calls' || error === 'child_calls_still_pending') && callId) {
      try {
        const failoverResult = await triggerRoundRobinFailoverFromCallId({
          callId,
          reason: 'child-never-answered-no-callback',
          currentChildCallSid: null,
          parentCallSid: twilioCallSid ?? null,
        });
        console.log('RR fallback failover from status-update (missing DialCallStatus):', {
          callId,
          twilioCallSid,
          error,
          failoverResult,
        });
        return { ok: true, action: 'recording-failed-failover', callId, error, failoverResult };
      } catch (err) {
        console.error('RR fallback failover from status-update failed:', {
          callId,
          twilioCallSid,
          error,
          failoverError: String(err),
        });
      }
    }
    return { ok: true, action: 'recording-failed', callId, error };
  }
  
  return { ok: true, ignored: true, reason: 'not-forwarding-status', status };
}

/**
 * Transfer update handler - activates recording on child calls when transfer completes
 * This is a backup in case status-update with forwarding doesn't fire
 */
async function processTransferRecording(body: unknown): Promise<HandlerResult | null> {
  const root = asRecord(body);
  const message = asRecord(root?.message) || root;
  
  const eventType = asString(message?.type);
  if (eventType !== 'transfer-update') return null;
  
  const call = asRecord(message?.call);
  const callId = asString(call?.id);
  const twilioCallSid = extractTwilioCallSid(call ?? {}, message);
  
  console.log('transfer-update received, attempting to start recording:', { callId, twilioCallSid });
  
  if (!twilioCallSid) {
    console.log('No twilioCallSid found in transfer-update');
    return { ok: true, ignored: true, reason: 'no-twilio-sid' };
  }
  
  // Wait a bit for the child call to be established
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const { childCallSid, recordingSid, error } = await startRecordingOnChildCalls(twilioCallSid);
  
  if (recordingSid) {
    await prisma.callMetric.upsert({
      where: { callId: callId ?? '' },
      create: {
        callId: callId ?? '',
        phoneNumber: 'unknown',
        twilioParentCallSid: twilioCallSid,
        twilioTransferCallSid: childCallSid,
        transferredAt: new Date(),
        lastEventType: 'transfer-update-recording',
        lastEventAt: new Date(),
      },
      update: {
        twilioParentCallSid: twilioCallSid,
        twilioTransferCallSid: childCallSid,
        lastEventType: 'transfer-update-recording',
        lastEventAt: new Date(),
      },
    });
    
    return { 
      ok: true, 
      action: 'recording-started-via-transfer-update', 
      callId, 
      twilioCallSid, 
      childCallSid, 
      recordingSid 
    };
  }
  
  console.log('Could not start recording via transfer-update:', { callId, error });
  if ((error === 'no_in_progress_child_calls' || error === 'child_calls_still_pending') && callId) {
    try {
      const failoverResult = await triggerRoundRobinFailoverFromCallId({
        callId,
        reason: 'child-never-answered',
        currentChildCallSid: null,
        parentCallSid: twilioCallSid ?? null,
      });
      console.log('Round robin failover from transfer-update:', { callId, failoverResult });
      return { ok: true, action: 'recording-failed-failover', callId, error, failoverResult };
    } catch (err) {
      console.error('Round robin failover from transfer-update failed:', {
        callId,
        error: String(err),
      });
    }
  }
  return { ok: true, action: 'recording-failed', callId, error };
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
  // 1. Assistant speech reached configured trigger status.
  // 2. It's the assistant speaking.
  // 3. It's Brenda specifically (assistantId check).
  // NOTE: do not gate by "turn" because Vapi turn numbering can vary by transport/config.
  if (
    status === BRENDA_TRANSFER_TRIGGER_STATUS &&
    role === 'assistant' && 
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
      if (attempt?.status === 'auto-transferred' || attempt?.status === 'auto-transferred-failover') {
        return { ok: true, ignored: true, reason: 'already-transferred', callId };
      }
      
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
      console.log('Auto-transfer trigger status:', BRENDA_TRANSFER_TRIGGER_STATUS);
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
    // Status update handler - start recording on child calls when forwarding
    const statusUpdate = await processStatusUpdate(req.body);
    if (statusUpdate) {
      const action = asRecord(statusUpdate)?.action;
      if (action === 'recording-started' || action === 'recording-failed') {
        return res.json({ ...statusUpdate, via: 'status-update' });
      }
      // If ignored, continue processing other event types
    }
    
    // Transfer recording handler (backup) - start recording when transfer-update fires
    const transferRecording = await processTransferRecording(req.body);
    if (transferRecording) {
      const action = asRecord(transferRecording)?.action;
      if (action === 'recording-started-via-transfer-update' || action === 'recording-failed') {
        return res.json({ ...transferRecording, via: 'transfer-update-recording' });
      }
      // If ignored, continue processing other event types
    }

    // Auto-transfer via speech-update (Brenda) to avoid confirmation loops in assistant prompt.
    const speechUpdate = await processSpeechUpdate(req.body);
    if (speechUpdate) {
      const action = asRecord(speechUpdate)?.action;
      if (action === 'auto-transfer' || asRecord(speechUpdate)?.ok === false) {
        return res.json({ ...speechUpdate, via: 'speech-update' });
      }
      // If ignored, continue with normal transfer/metrics handlers.
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

/**
 * Twilio recording status callback
 * Receives notification when a recording completes
 */
router.post('/twilio/recording-status', async (req, res) => {
  try {
    const body = req.body;
    const callSid = body.CallSid;
    const recordingSid = body.RecordingSid;
    const recordingUrl = body.RecordingUrl;
    const recordingStatus = body.RecordingStatus;
    const recordingDuration = body.RecordingDuration;
    
    console.log('Twilio recording-status callback:', {
      callSid,
      recordingSid,
      recordingStatus,
      recordingDuration,
      recordingUrl,
    });
    
    if (recordingStatus !== 'completed') {
      return res.status(200).send('OK');
    }
    
    // Find the call metric by twilioTransferCallSid
    const metric = await prisma.callMetric.findFirst({
      where: { twilioTransferCallSid: callSid },
    });
    
    if (metric) {
      const durationSec = recordingDuration ? parseInt(recordingDuration, 10) : null;
      const fullRecordingUrl = recordingUrl ? `${recordingUrl}.mp3` : null;
      
      // Update recording URL first
      await prisma.callMetric.update({
        where: { id: metric.id },
        data: {
          transferRecordingUrl: fullRecordingUrl,
          transferRecordingDurationSec: Number.isFinite(durationSec) ? durationSec : null,
          postTransferDurationSec: Number.isFinite(durationSec) ? durationSec : metric.postTransferDurationSec,
          lastEventType: 'twilio-recording-completed',
          lastEventAt: new Date(),
        },
      });
      
      console.log('Updated call metric with transfer recording:', {
        callId: metric.callId,
        transferRecordingUrl: fullRecordingUrl,
        durationSec,
      });
      
      // Auto-transcribe with OpenAI if available (async, don't block response)
      if (fullRecordingUrl && canTranscribeRecording()) {
        transcribeRecordingFromUrl(fullRecordingUrl)
          .then(async ({ text, source }) => {
            if (text) {
              const updatedMetric = await prisma.callMetric.findUnique({
                where: { id: metric.id },
                select: { transcript: true },
              });
              const fullTranscript = composeFullTranscript(updatedMetric?.transcript ?? null, text);
              await prisma.callMetric.update({
                where: { id: metric.id },
                data: {
                  transferTranscript: text,
                  fullTranscript: fullTranscript ?? undefined,
                  lastEventType: 'auto-transcription-completed',
                  lastEventAt: new Date(),
                },
              });
              console.log('Auto-transcribed transfer recording:', { callId: metric.callId, source, chars: text.length });
            }
          })
          .catch((err) => {
            console.warn('Auto-transcription failed:', { callId: metric.callId, error: String(err) });
          });
      }
    } else {
      // Try to find by parent call SID (the child call may not be linked yet)
      const link = await prisma.twilioCallLink.findFirst({
        where: { childCallSid: callSid },
      });
      
      if (link) {
        console.log('Found TwilioCallLink for recording, updating metric:', link.vapiCallId);
        const fullRecordingUrl = recordingUrl ? `${recordingUrl}.mp3` : null;
        const durationSec = recordingDuration ? parseInt(recordingDuration, 10) : null;
        
        await prisma.callMetric.updateMany({
          where: { callId: link.vapiCallId },
          data: {
            twilioTransferCallSid: callSid,
            transferRecordingUrl: fullRecordingUrl,
            transferRecordingDurationSec: Number.isFinite(durationSec) ? durationSec : null,
            postTransferDurationSec: Number.isFinite(durationSec) ? durationSec : undefined,
            lastEventType: 'twilio-recording-completed',
            lastEventAt: new Date(),
          },
        });
      } else {
        console.log('No metric found for recording callback, callSid:', callSid);
      }
    }
    
    return res.status(200).send('OK');
  } catch (error) {
    console.error('Recording status webhook error:', error);
    return res.status(500).send('Error');
  }
});

/**
 * Twilio transcription callback
 * Receives transcription when it completes
 */
router.post('/twilio/transcription-complete', async (req, res) => {
  try {
    const body = req.body;
    const recordingSid = body.RecordingSid;
    const transcriptionText = body.TranscriptionText;
    const transcriptionStatus = body.TranscriptionStatus;
    
    console.log('Twilio transcription-complete callback:', {
      recordingSid,
      transcriptionStatus,
      hasText: !!transcriptionText,
    });
    
    if (transcriptionStatus !== 'completed' || !transcriptionText) {
      return res.status(200).send('OK');
    }
    
    // Find the metric by recording URL pattern
    const metric = await prisma.callMetric.findFirst({
      where: {
        transferRecordingUrl: { contains: recordingSid },
      },
    });
    
    if (metric) {
      const fullTranscript = composeFullTranscript(metric.transcript, transcriptionText);
      
      await prisma.callMetric.update({
        where: { id: metric.id },
        data: {
          transferTranscript: transcriptionText,
          fullTranscript,
          lastEventType: 'twilio-transcription-completed',
          lastEventAt: new Date(),
        },
      });
      
      console.log('Updated call metric with Twilio transcription:', {
        callId: metric.callId,
        hasTranscript: true,
      });
    }
    
    return res.status(200).send('OK');
  } catch (error) {
    console.error('Transcription webhook error:', error);
    return res.status(500).send('Error');
  }
});

/**
 * Re-transcribe a transfer recording for an existing call
 * POST /webhooks/twilio/retranscribe/:callId
 */
router.post('/twilio/retranscribe/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    
    if (!callId) {
      return res.status(400).json({ ok: false, error: 'Missing callId' });
    }
    
    const metric = await prisma.callMetric.findUnique({
      where: { callId },
    });
    
    if (!metric) {
      return res.status(404).json({ ok: false, error: 'Call not found' });
    }
    
    if (!metric.transferRecordingUrl) {
      return res.status(400).json({ ok: false, error: 'No transfer recording URL found' });
    }
    
    console.log('Re-transcribing transfer recording:', { callId, url: metric.transferRecordingUrl });
    
    if (!canTranscribeRecording()) {
      return res.status(500).json({ ok: false, error: 'Transcription not available (check OPENAI_API_KEY or WHISPER_LOCAL_ENABLED)' });
    }
    
    const transcription = await transcribeRecordingFromUrl(metric.transferRecordingUrl);
    
    if (!transcription.text) {
      return res.status(500).json({ ok: false, error: 'Transcription failed', source: transcription.source });
    }
    
    const fullTranscript = composeFullTranscript(metric.transcript, transcription.text);
    
    await prisma.callMetric.update({
      where: { id: metric.id },
      data: {
        transferTranscript: transcription.text,
        fullTranscript,
        lastEventType: 'manual-retranscribe',
        lastEventAt: new Date(),
      },
    });
    
    console.log('Re-transcription successful:', { callId, source: transcription.source, length: transcription.text.length });
    
    return res.json({
      ok: true,
      callId,
      source: transcription.source,
      transferTranscript: transcription.text,
      fullTranscript,
    });
  } catch (error) {
    console.error('Re-transcription error:', error);
    return res.status(500).json({ ok: false, error: 'Internal error', message: String(error) });
  }
});

export default router;
