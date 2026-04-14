/**
 * Dashboard metrics API endpoints
 * Provides summary, daily trends, and recent calls data
 */

import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { canTranscribeRecording, composeFullTranscript, transcribeRecordingFromUrl } from '../lib/transcription.js';

const router = Router();
// Minimum duration fallback for transfer connection heuristic.
// Some providers report duration=0 even when transfer is successful.
const TRANSFER_CONNECTED_MIN_SEC = Number(process.env.TRANSFER_CONNECTED_MIN_SEC ?? 10);
const DASHBOARD_TIMEZONE = 'America/Mexico_City';
const DEFAULT_BACKFILL_LIMIT = Number(process.env.METRICS_BACKFILL_LIMIT ?? 100);
const MAX_BACKFILL_LIMIT = Number(process.env.METRICS_BACKFILL_MAX_LIMIT ?? 500);
const VAPI_API_KEY = process.env.VAPI_API_KEY ?? '';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? '';
const CONNECTED_TRANSFER_STATUSES = new Set(['in-progress', 'answered', 'completed']);

type TzDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const TZ_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: DASHBOARD_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function getTzDateParts(date: Date): TzDateParts {
  const parts = TZ_DATE_TIME_FORMATTER.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function zonedDateTimeToUtc(parts: TzDateParts): Date {
  const approxUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0));
  const approxTzParts = getTzDateParts(approxUtc);
  const targetAsUtcMillis = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
  const approxAsTzMillis = Date.UTC(
    approxTzParts.year,
    approxTzParts.month - 1,
    approxTzParts.day,
    approxTzParts.hour,
    approxTzParts.minute,
    approxTzParts.second,
    0,
  );
  return new Date(approxUtc.getTime() + (targetAsUtcMillis - approxAsTzMillis));
}

function shiftDateKey(parts: Pick<TzDateParts, 'year' | 'month' | 'day'>, deltaDays: number) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + deltaDays));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function startOfTzDay(parts: Pick<TzDateParts, 'year' | 'month' | 'day'>): Date {
  return zonedDateTimeToUtc({ ...parts, hour: 0, minute: 0, second: 0 });
}

function getDateKeyInTimezone(date: Date): string {
  const parts = getTzDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function twilioAuthHeader(): string {
  return `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`;
}

function canUseTwilioSync(): boolean {
  return !!TWILIO_ACCOUNT_SID && !!TWILIO_AUTH_TOKEN;
}

function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const keepPlus = value.trim().startsWith('+');
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return null;
  return keepPlus ? `+${digits}` : digits;
}

type TwilioCallItem = {
  sid?: string;
  to?: string;
  status?: string;
  duration?: string;
};

type TwilioRecordingItem = {
  sid?: string;
  status?: string;
  duration?: string;
};

async function fetchTwilioChildCalls(parentCallSid: string): Promise<TwilioCallItem[]> {
  if (!canUseTwilioSync() || !parentCallSid) return [];
  const url = new URL(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`);
  url.searchParams.set('ParentCallSid', parentCallSid);
  url.searchParams.set('PageSize', '20');
  const resp = await fetch(url.toString(), {
    headers: { Authorization: twilioAuthHeader() },
  });
  if (!resp.ok) return [];
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  return Array.isArray(data.calls) ? (data.calls as TwilioCallItem[]) : [];
}

function pickTransferChild(
  calls: TwilioCallItem[],
  expectedTransferNumber: string | null | undefined
): TwilioCallItem | null {
  if (!calls.length) return null;
  const normalizedExpected = normalizePhone(expectedTransferNumber);
  const ranked = calls
    .map((c) => {
      const durationSec = Number.parseInt(c.duration ?? '0', 10);
      const normalizedTo = normalizePhone(c.to);
      const score =
        (normalizedExpected && normalizedTo && normalizedExpected === normalizedTo ? 10 : 0) +
        (Number.isFinite(durationSec) && durationSec > 0 ? 3 : 0) +
        ((c.status ?? '').toLowerCase() === 'completed' ? 1 : 0);
      return { c, score };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.c ?? null;
}

async function fetchTwilioLatestRecording(callSid: string): Promise<{
  recordingUrl: string | null;
  recordingDurationSec: number | null;
}> {
  if (!canUseTwilioSync() || !callSid) {
    return { recordingUrl: null, recordingDurationSec: null };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${encodeURIComponent(callSid)}/Recordings.json?PageSize=20`;
  const resp = await fetch(url, {
    headers: { Authorization: twilioAuthHeader() },
  });
  if (!resp.ok) return { recordingUrl: null, recordingDurationSec: null };
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  const recordings = (Array.isArray(data.recordings) ? data.recordings : []) as TwilioRecordingItem[];
  if (!recordings.length) return { recordingUrl: null, recordingDurationSec: null };
  const preferred =
    recordings.find((r) => (r.status ?? '').toLowerCase() === 'completed') ??
    recordings[0];
  const sid = preferred?.sid ?? null;
  const durationSec = Number.parseInt(preferred?.duration ?? '0', 10);
  return {
    recordingUrl: sid ? `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${sid}.mp3` : null,
    recordingDurationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null,
  };
}

function pickTimestamp(rec: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString(rec[key]);
    if (value) return value;
  }
  return undefined;
}

function buildTranscriptFromMessages(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  const lines = messages
    .map((m) => {
      if (!m || typeof m !== 'object') return null;
      const msg = m as Record<string, unknown>;
      const role = typeof msg.role === 'string' ? msg.role : null;
      const text = typeof msg.message === 'string' ? msg.message : null;
      if (!text) return null;
      if (!role) return text;
      if (role === 'assistant') return `AI: ${text}`;
      if (role === 'user') return `User: ${text}`;
      return `${role}: ${text}`;
    })
    .filter((x): x is string => !!x);
  return lines.length ? lines.join('\n') : null;
}

function extractCallSnapshotFromVapiPayload(payload: unknown) {
  const root = asRecord(payload);
  if (!root) return null;

  const message = asRecord(root.message);
  const artifact = asRecord(root.artifact) || asRecord(message?.artifact);
  const call = asRecord(root.call) || asRecord(message?.call) || root;
  if (!call) return null;

  const callId = asString(call.id);
  if (!callId) return null;

  const customer = asRecord(call.customer);
  const destination = asRecord(call.destination);
  const recording = asRecord(artifact?.recording);
  const transcript =
    asString(artifact?.transcript) ||
    asString(root.transcript) ||
    buildTranscriptFromMessages(root.messages) ||
    buildTranscriptFromMessages(message?.messages) ||
    null;

  const cost = asNumber(call.cost) ?? asNumber(root.cost);
  const duration = asNumber(call.duration) ?? asNumber(call.durationSeconds) ?? asNumber(root.duration);
  const startedAt = pickTimestamp(call, ['startedAt', 'started_at', 'createdAt', 'created_at']);
  const transferredAt = pickTimestamp(call, ['transferredAt', 'transferred_at']);
  const endedAt = pickTimestamp(call, ['endedAt', 'ended_at', 'updatedAt', 'updated_at']);

  return {
    callId,
    phoneNumber: asString(customer?.number),
    assistantId: asString(call.assistantId) || asString(asRecord(call.assistant)?.id),
    transferNumber:
      asString(call.forwardedPhoneNumber) ||
      asString(call.transferNumber) ||
      asString(destination?.number),
    startedAt: startedAt ? new Date(startedAt) : null,
    transferredAt: transferredAt ? new Date(transferredAt) : null,
    endedAt: endedAt ? new Date(endedAt) : null,
    durationSec: duration ?? null,
    endedReason: asString(call.endedReason) || asString(call.ended_reason) || null,
    transcript,
    recordingUrl: asString(recording?.url) || asString(artifact?.recordingUrl) || null,
    cost: cost ?? null,
  };
}

function buildBackfillWhere(onlyMissing: boolean) {
  if (!onlyMissing) return {};
  return {
    OR: [
      { assistantId: null },
      { transferNumber: null },
      { startedAt: null },
      { transferredAt: null },
      { endedAt: null },
      { durationSec: null },
      { endedReason: null },
      { transcript: null },
      { recordingUrl: null },
      { cost: null },
    ],
  };
}

type BackfillError = { callId: string; status?: number; message: string };
type BackfillBatchResult = {
  dryRun: boolean;
  onlyMissing: boolean;
  limit: number;
  selected: number;
  attempted: number;
  updated: number;
  skipped: number;
  errors: BackfillError[];
  processedCallIds: string[];
};

async function runBackfillBatch(params: {
  apiKey: string;
  limit: number;
  onlyMissing: boolean;
  dryRun: boolean;
  excludeCallIds?: string[];
}): Promise<BackfillBatchResult> {
  const { apiKey, limit, onlyMissing, dryRun, excludeCallIds = [] } = params;

  const where: Record<string, unknown> = buildBackfillWhere(onlyMissing);
  if (excludeCallIds.length > 0) {
    where.callId = { notIn: excludeCallIds };
  }

  const candidates = await prisma.callMetric.findMany({
    where: where as any,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      callId: true,
      phoneNumber: true,
      assistantId: true,
      transferNumber: true,
      startedAt: true,
      transferredAt: true,
      endedAt: true,
      durationSec: true,
      endedReason: true,
      transcript: true,
      recordingUrl: true,
      cost: true,
    },
  });

  let attempted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: BackfillError[] = [];

  for (const metric of candidates) {
    attempted++;

    let vapiResponse: Response;
    try {
      vapiResponse = await fetch(`https://api.vapi.ai/call/${metric.callId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch (error) {
      errors.push({ callId: metric.callId, message: `network_error: ${String(error)}` });
      continue;
    }

    const payload = await vapiResponse.json().catch(() => ({}));
    if (!vapiResponse.ok) {
      errors.push({
        callId: metric.callId,
        status: vapiResponse.status,
        message: asString(asRecord(payload)?.message) || 'vapi_call_lookup_failed',
      });
      continue;
    }

    const snapshot = extractCallSnapshotFromVapiPayload(payload);
    if (!snapshot) {
      skipped++;
      continue;
    }

    const patch = buildMetricPatch(metric, snapshot);

    if (!Object.keys(patch).length) {
      skipped++;
      continue;
    }

    if (!dryRun) {
      await prisma.callMetric.update({
        where: { callId: metric.callId },
        data: patch,
      });
    }
    updated++;
  }

  return {
    dryRun,
    onlyMissing,
    limit,
    selected: candidates.length,
    attempted,
    updated,
    skipped,
    errors,
    processedCallIds: candidates.map((c) => c.callId),
  };
}

function buildMetricPatch(metric: {
  phoneNumber: string;
  assistantId: string | null;
  transferNumber: string | null;
  startedAt: Date | null;
  transferredAt: Date | null;
  endedAt: Date | null;
  durationSec: number | null;
  endedReason: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  cost: unknown;
}, snapshot: {
  phoneNumber?: string;
  assistantId?: string;
  transferNumber?: string;
  startedAt: Date | null;
  transferredAt: Date | null;
  endedAt: Date | null;
  durationSec: number | null;
  endedReason: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  cost: number | null;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (snapshot.phoneNumber && metric.phoneNumber === 'unknown') patch.phoneNumber = snapshot.phoneNumber;
  if (snapshot.assistantId && snapshot.assistantId !== metric.assistantId) patch.assistantId = snapshot.assistantId;
  if (snapshot.transferNumber && snapshot.transferNumber !== metric.transferNumber) patch.transferNumber = snapshot.transferNumber;
  if (snapshot.startedAt && !metric.startedAt) patch.startedAt = snapshot.startedAt;
  if (snapshot.transferredAt && !metric.transferredAt) patch.transferredAt = snapshot.transferredAt;
  if (snapshot.endedAt && !metric.endedAt) patch.endedAt = snapshot.endedAt;
  if (snapshot.durationSec !== null && metric.durationSec == null) patch.durationSec = snapshot.durationSec;
  if (snapshot.endedReason && !metric.endedReason) patch.endedReason = snapshot.endedReason;
  if (snapshot.transcript && !metric.transcript) patch.transcript = snapshot.transcript;
  if (snapshot.recordingUrl && !metric.recordingUrl) patch.recordingUrl = snapshot.recordingUrl;
  if (snapshot.cost !== null && metric.cost == null) patch.cost = snapshot.cost;
  return patch;
}

function parseBooleanFlag(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === '') return defaultValue;
  const raw = String(value).toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return defaultValue;
}

// Helper: Get date range for period
function getPeriodDates(period: string) {
  const now = new Date();
  const nowTz = getTzDateParts(now);
  const day0 = { year: nowTz.year, month: nowTz.month, day: nowTz.day };
  const dayMinus = (n: number) => shiftDateKey(day0, -n);
  const dayStart = (n: number) => startOfTzDay(dayMinus(n));
  
  let startDate: Date, endDate: Date, prevStartDate: Date, prevEndDate: Date;
  
  switch (period) {
    case 'Ayer':
      startDate = dayStart(1);
      endDate = dayStart(0);
      prevStartDate = dayStart(2);
      prevEndDate = dayStart(1);
      break;
    case '7 días':
      startDate = dayStart(7);
      endDate = now;
      prevStartDate = dayStart(14);
      prevEndDate = dayStart(7);
      break;
    case '30 días':
      startDate = dayStart(30);
      endDate = now;
      prevStartDate = dayStart(60);
      prevEndDate = dayStart(30);
      break;
    default: // Hoy
      startDate = dayStart(0);
      endDate = now;
      prevStartDate = dayStart(1);
      prevEndDate = dayStart(0);
  }
  
  return { startDate, endDate, prevStartDate, prevEndDate };
}

// GET /api/metrics/summary
router.get('/summary', async (req, res) => {
  try {
    const period = req.query.period as string || 'Hoy';
    const { startDate, endDate, prevStartDate, prevEndDate } = getPeriodDates(period);
    
    // Current period counts
    const [current, previous] = await Promise.all([
      prisma.callMetric.aggregate({
        where: { startedAt: { gte: startDate, lt: endDate } },
        _count: { _all: true },
        _avg: { durationSec: true },
      }),
      prisma.callMetric.aggregate({
        where: { startedAt: { gte: prevStartDate, lt: prevEndDate } },
        _count: { _all: true },
        _avg: { durationSec: true },
      }),
    ]);
    
    const [currentRows, previousRows, inProgress] = await Promise.all([
      prisma.callMetric.findMany({
        where: { startedAt: { gte: startDate, lt: endDate } },
        select: {
          outcome: true,
          sentiment: true,
          endedReason: true,
          transferredAt: true,
          endedAt: true,
          twilioTransferCallSid: true,
          transferStatus: true,
          postTransferDurationSec: true,
        },
      }),
      prisma.callMetric.findMany({
        where: { startedAt: { gte: prevStartDate, lt: prevEndDate } },
        select: {
          outcome: true,
          sentiment: true,
          endedReason: true,
          transferredAt: true,
          endedAt: true,
          twilioTransferCallSid: true,
          transferStatus: true,
          postTransferDurationSec: true,
        },
      }),
      prisma.callMetric.count({
        where: { inProgress: true },
      }),
    ]);
    
    // Calculate avg time to transfer
    const transferCalls = await prisma.callMetric.findMany({
      where: {
        startedAt: { gte: startDate, lt: endDate },
        transferredAt: { not: null },
      },
      select: { startedAt: true, transferredAt: true },
    });
    
    const avgTimeToTransfer = transferCalls.length > 0
      ? transferCalls.reduce((sum: number, c: { startedAt: Date | null; transferredAt: Date | null }) => {
          if (c.startedAt && c.transferredAt) {
            return sum + (c.transferredAt.getTime() - c.startedAt.getTime()) / 1000;
          }
          return sum;
        }, 0) / transferCalls.length
      : 0;
    
    const outcomeMap: Record<string, number> = {};
    const prevOutcomeMap: Record<string, number> = {};
    const sentimentMap: Record<string, number> = {};
    let connectedTransfers = 0;
    let prevConnectedTransfers = 0;

    for (const row of currentRows) {
      const normalized = normalizeMetricClassification({
        outcome: row.outcome,
        sentiment: row.sentiment,
        endedReason: row.endedReason,
        transferredAt: row.transferredAt,
        endedAt: row.endedAt,
        twilioTransferCallSid: row.twilioTransferCallSid,
        transferStatus: row.transferStatus,
        postTransferDurationSec: row.postTransferDurationSec,
      });
      outcomeMap[normalized.outcome] = (outcomeMap[normalized.outcome] || 0) + 1;
      sentimentMap[normalized.sentiment] = (sentimentMap[normalized.sentiment] || 0) + 1;
      if (normalized.hasConnectedTransfer) connectedTransfers++;
    }

    for (const row of previousRows) {
      const normalized = normalizeMetricClassification({
        outcome: row.outcome,
        sentiment: row.sentiment,
        endedReason: row.endedReason,
        transferredAt: row.transferredAt,
        endedAt: row.endedAt,
        twilioTransferCallSid: row.twilioTransferCallSid,
        transferStatus: row.transferStatus,
        postTransferDurationSec: row.postTransferDurationSec,
      });
      prevOutcomeMap[normalized.outcome] = (prevOutcomeMap[normalized.outcome] || 0) + 1;
      if (normalized.hasConnectedTransfer) prevConnectedTransfers++;
    }
    
    const totalCalls = current._count._all;
    const transfersInitiated = outcomeMap['transfer_success'] || 0;
    const abandoned = outcomeMap['abandoned'] || 0;
    
    const transferRate = totalCalls > 0 ? transfersInitiated / totalCalls : 0;
    const transferConnectedRate = totalCalls > 0 ? connectedTransfers / totalCalls : 0;
    const transferConnectionSuccessRate = transfersInitiated > 0 ? connectedTransfers / transfersInitiated : 0;
    const abandonRate = totalCalls > 0 ? abandoned / totalCalls : 0;
    
    // Calculate deltas
    const prevTotal = previous._count._all;
    const prevTransfersInitiated = prevOutcomeMap['transfer_success'] || 0;
    const prevAbandoned = prevOutcomeMap['abandoned'] || 0;
    const prevTransferRate = prevTotal > 0 ? prevTransfersInitiated / prevTotal : 0;
    const prevTransferConnectedRate = prevTotal > 0 ? prevConnectedTransfers / prevTotal : 0;
    const prevAbandonRate = prevTotal > 0 ? prevAbandoned / prevTotal : 0;
    
    res.json({
      totalCalls,
      transferRate,
      transferConnectedRate,
      transfersInitiated,
      transfersConnected: connectedTransfers,
      transferConnectionSuccessRate,
      abandonRate,
      avgTimeToTransfer: Math.round(avgTimeToTransfer),
      inProgressCount: inProgress,
      sentimentCounts: {
        positive: sentimentMap['positive'] || 0,
        neutral: sentimentMap['neutral'] || 0,
        negative: sentimentMap['negative'] || 0,
      },
      deltas: {
        totalCalls: prevTotal > 0 ? (totalCalls - prevTotal) / prevTotal : 0,
        transferRate: transferRate - prevTransferRate,
        transferConnectedRate: transferConnectedRate - prevTransferConnectedRate,
        abandonRate: abandonRate - prevAbandonRate,
        avgTimeToTransfer: avgTimeToTransfer > 0 ? -0.15 : 0, // Placeholder
      },
    });
  } catch (error) {
    console.error('Summary error:', error);
    res.status(500).json({ error: 'Internal error', message: String(error) });
  }
});

// GET /api/metrics/daily
router.get('/daily', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 7, 30);
    const now = new Date();
    const nowTz = getTzDateParts(now);
    const startDay = shiftDateKey({ year: nowTz.year, month: nowTz.month, day: nowTz.day }, -days);
    const startDate = startOfTzDay(startDay);
    
    const calls = await prisma.callMetric.findMany({
      where: { startedAt: { gte: startDate } },
      select: {
        startedAt: true,
        outcome: true,
        sentiment: true,
        endedReason: true,
        transferredAt: true,
        endedAt: true,
        twilioTransferCallSid: true,
        transferStatus: true,
        postTransferDurationSec: true,
      },
    });
    
    // Group by day
    const dayMap = new Map<string, { calls: number; transfers: number; abandoned: number }>();
    
    for (const call of calls) {
      if (!call.startedAt) continue;
      
      const dateKey = getDateKeyInTimezone(call.startedAt);
      const entry = dayMap.get(dateKey) || { calls: 0, transfers: 0, abandoned: 0 };
      const normalized = normalizeMetricClassification({
        outcome: call.outcome,
        sentiment: call.sentiment,
        endedReason: call.endedReason,
        transferredAt: call.transferredAt,
        endedAt: call.endedAt,
        twilioTransferCallSid: call.twilioTransferCallSid,
        transferStatus: call.transferStatus,
        postTransferDurationSec: call.postTransferDurationSec,
      });
      
      entry.calls++;
      if (normalized.outcome === 'transfer_success') entry.transfers++;
      if (normalized.outcome === 'abandoned') entry.abandoned++;
      
      dayMap.set(dateKey, entry);
    }
    
    // Convert to sorted array
    const dayNames: Record<number, string> = {
      0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb'
    };
    
    const today = getDateKeyInTimezone(now);
    
    const result = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        day: date === today ? 'Hoy' : dayNames[new Date(`${date}T12:00:00Z`).getUTCDay()],
        ...data,
      }));
    
    res.json(result);
  } catch (error) {
    console.error('Daily error:', error);
    res.status(500).json({ error: 'Internal error', message: String(error) });
  }
});

// GET /api/metrics/recent
router.get('/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const sentiment = req.query.sentiment as string | undefined;
    const outcome = req.query.outcome as string | undefined;
    const search = req.query.search as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(`${to}T23:59:59.999Z`) : undefined;
    if (from && (!fromDate || Number.isNaN(fromDate.getTime()))) {
      return res.status(400).json({ error: 'invalid_query', field: 'from' });
    }
    if (to && (!toDate || Number.isNaN(toDate.getTime()))) {
      return res.status(400).json({ error: 'invalid_query', field: 'to' });
    }

    const where: {
      sentiment?: string;
      outcome?: string;
      phoneNumber?: { contains: string };
      startedAt?: { gte?: Date; lte?: Date };
    } = {};
    if (sentiment && sentiment !== 'all') where.sentiment = sentiment;
    if (outcome && outcome !== 'all') where.outcome = outcome;
    if (search) where.phoneNumber = { contains: search };
    if (fromDate || toDate) {
      where.startedAt = {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      };
    }
    
    const calls = await prisma.callMetric.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        callId: true,
        phoneNumber: true,
        assistantId: true,
        transferNumber: true,
        twilioParentCallSid: true,
        twilioTransferCallSid: true,
        transferStatus: true,
        endedReason: true,
        outcome: true,
        sentiment: true,
        durationSec: true,
        postTransferDurationSec: true,
        transferTranscript: true,
        transferRecordingUrl: true,
        startedAt: true,
        transferredAt: true,
        endedAt: true,
        lastEventAt: true,
        createdAt: true,
        inProgress: true,
      },
    });

    const callIds = calls.map((c) => c.callId);
    const attempts = callIds.length
      ? await prisma.callAttempt.findMany({
          where: { providerId: { in: callIds } },
          orderBy: [{ providerId: 'asc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            leadId: true,
            providerId: true,
            resultJson: true,
            createdAt: true,
          },
        })
      : [];

    const latestAttemptByCallId = new Map<string, (typeof attempts)[number]>();
    for (const attempt of attempts) {
      if (!attempt.providerId) continue;
      if (!latestAttemptByCallId.has(attempt.providerId)) {
        latestAttemptByCallId.set(attempt.providerId, attempt);
      }
    }

    const leadIds = Array.from(
      new Set(
        Array.from(latestAttemptByCallId.values())
          .map((a) => a.leadId)
          .filter((leadId): leadId is string => !!leadId),
      ),
    );

    const transferFailoverEvents = leadIds.length
      ? await prisma.event.findMany({
          where: {
            leadId: { in: leadIds },
            type: 'transfer_failover',
          },
          orderBy: { createdAt: 'asc' },
          select: {
            leadId: true,
            createdAt: true,
            detail: true,
          },
        })
      : [];

    const failoverEventsByCallId = new Map<
      string,
      Array<{
        at: Date;
        reason: string | null;
        failedAgentIndex: number | null;
        failedAgentName: string | null;
        failedAgentNumber: string | null;
        failedAgentResult: string | null;
        nextIndex: number | null;
        nextAgentName: string | null;
        nextTransferNumber: string | null;
      }>
    >();
    for (const event of transferFailoverEvents) {
      const detail = asRecord(event.detail);
      const eventCallId = asString(detail?.callId);
      if (!eventCallId) continue;
      const list = failoverEventsByCallId.get(eventCallId) ?? [];
      list.push({
        at: event.createdAt,
        reason: asString(detail?.reason) ?? null,
        failedAgentIndex: asNumber(detail?.failedAgentIndex) ?? null,
        failedAgentName: asString(detail?.failedAgentName) ?? null,
        failedAgentNumber: asString(detail?.failedAgentNumber) ?? null,
        failedAgentResult: asString(detail?.failedAgentResult) ?? asString(detail?.reason) ?? null,
        nextIndex: asNumber(detail?.nextIndex) ?? null,
        nextAgentName: asString(detail?.nextAgentName) ?? null,
        nextTransferNumber: asString(detail?.nextTransferNumber) ?? null,
      });
      failoverEventsByCallId.set(eventCallId, list);
    }

    res.json(calls.map((c: any) => {
      const attempt = latestAttemptByCallId.get(c.callId);
      const attemptResult = asRecord(attempt?.resultJson);
      const selectedAgent = asRecord(attemptResult?.selected_agent);
      const roundRobin = asRecord(attemptResult?.roundRobin);
      const humanAgentName =
        asString(selectedAgent?.human_agent_name) ??
        asString(roundRobin?.selectedAgentName) ??
        asString(attemptResult?.humanAgentName) ??
        null;
      const roundRobinEnabled =
        asBoolean(selectedAgent?.round_robin_enabled) ??
        asBoolean(roundRobin?.enabled) ??
        false;
      const roundRobinIndex =
        asNumber(selectedAgent?.round_robin_index) ??
        asNumber(roundRobin?.selectedAgentIndex) ??
        null;
      const roundRobinPoolSize =
        asNumber(selectedAgent?.round_robin_pool_size) ??
        asNumber(roundRobin?.poolSize) ??
        null;
      const answeredAgentName = asString(roundRobin?.answeredAgentName) ?? null;
      const answeredAgentNumber = asString(roundRobin?.answeredAgentNumber) ?? null;
      const answeredAgentIndex = asNumber(roundRobin?.answeredAgentIndex) ?? null;
      const failoverSteps = failoverEventsByCallId.get(c.callId) ?? [];
      const firstFailoverStep = failoverSteps.find((step) => step.failedAgentIndex === 0) ?? null;
      const failedAgents = failoverSteps
        .map((step) => ({
          index: step.failedAgentIndex,
          name: step.failedAgentName,
          number: step.failedAgentNumber,
          result: step.failedAgentResult,
        }))
        .filter((agent) => agent.name || agent.number);
      const uniqueFailedAgents = failedAgents.filter((agent, index, arr) => {
        const key = `${agent.index ?? 'na'}|${agent.number ?? ''}|${agent.name ?? ''}|${agent.result ?? ''}`;
        return arr.findIndex((item) => `${item.index ?? 'na'}|${item.number ?? ''}|${item.name ?? ''}|${item.result ?? ''}` === key) === index;
      });
      const firstAgentResult =
        asString(roundRobin?.firstAgentResult) ??
        firstFailoverStep?.failedAgentResult ??
        (answeredAgentIndex === 0 ? 'human-answered' : null);
      const firstAgentName =
        asString(roundRobin?.firstAgentName) ??
        firstFailoverStep?.failedAgentName ??
        (answeredAgentIndex === 0 ? answeredAgentName : null);
      const firstAgentNumber =
        asString(roundRobin?.firstAgentNumber) ??
        firstFailoverStep?.failedAgentNumber ??
        (answeredAgentIndex === 0 ? answeredAgentNumber : null);
      const agentsTriedCount = roundRobinEnabled
        ? Math.max(
            1,
            uniqueFailedAgents.length + (answeredAgentName || answeredAgentNumber ? 1 : 0),
            failoverSteps.length + 1,
          )
        : null;

      const duration = computeDurationSeconds(c.durationSec, c.startedAt, c.endedAt, c.lastEventAt);
      const sellerTalk =
        c.postTransferDurationSec && c.postTransferDurationSec > 0
          ? c.postTransferDurationSec
          : diffSeconds(c.transferredAt, c.endedAt);
      const dataQuality = resolveDataQuality({
        twilioParentCallSid: c.twilioParentCallSid,
        twilioTransferCallSid: c.twilioTransferCallSid,
        transferStatus: c.transferStatus,
        postTransferDurationSec: c.postTransferDurationSec,
        transferRecordingUrl: c.transferRecordingUrl,
        transferTranscript: c.transferTranscript,
      });
      const transferRecordingSource = resolveRecordingSource({
        transferRecordingUrl: c.transferRecordingUrl,
        recordingUrl: null, // Not fetched in recent for performance
        twilioTransferCallSid: c.twilioTransferCallSid,
      });
      const transferTranscriptSource = resolveTranscriptSource({
        transferTranscript: c.transferTranscript,
        transcript: null, // Not fetched in recent for performance
        twilioTransferCallSid: c.twilioTransferCallSid,
      });
      const normalized = normalizeMetricClassification({
        outcome: c.outcome,
        sentiment: c.sentiment,
        endedReason: c.endedReason,
        transferredAt: c.transferredAt,
        endedAt: c.endedAt,
        twilioTransferCallSid: c.twilioTransferCallSid,
        transferStatus: c.transferStatus,
        postTransferDurationSec: c.postTransferDurationSec,
      });
      return {
        callId: c.callId,
        phone: maskPhone(c.phoneNumber),
        assistantId: c.assistantId,
        transferNumber: c.transferNumber,
        humanAgentName,
        roundRobinEnabled,
        roundRobinIndex,
        roundRobinPoolSize,
        roundRobinAnsweredAgentName: answeredAgentName,
        roundRobinAnsweredAgentNumber: answeredAgentNumber,
        roundRobinAnsweredAgentIndex: answeredAgentIndex,
        roundRobinFirstAgentResult: roundRobinEnabled ? firstAgentResult : null,
        roundRobinFirstAgentName: roundRobinEnabled ? firstAgentName : null,
        roundRobinFirstAgentNumber: roundRobinEnabled ? firstAgentNumber : null,
        roundRobinAgentsTriedCount: agentsTriedCount,
        roundRobinFailedAgents: roundRobinEnabled ? uniqueFailedAgents : [],
        twilioTransferCallSid: c.twilioTransferCallSid,
        transferStatus: c.transferStatus,
        outcome: normalized.outcome,
        sentiment: normalized.sentiment,
        duration,
        durationSource: durationSource(c.durationSec, c.startedAt, c.endedAt, c.lastEventAt),
        startedAt: c.startedAt,
        transferredAt: c.transferredAt,
        endedAt: c.endedAt,
        timeToTransferSec: diffSeconds(c.startedAt, c.transferredAt),
        sellerTalkSec: sellerTalk,
        sellerTalkSource: sellerTalkSource(c.postTransferDurationSec, c.transferredAt, c.endedAt),
        postTransferDurationSec: c.postTransferDurationSec,
        transferRecordingSource,
        transferTranscriptSource,
        dataQuality,
        ago: formatRelativeTime(c.startedAt ?? c.createdAt),
        inProgress: c.inProgress,
      };
    }));
  } catch (error) {
    console.error('Recent error:', error);
    res.status(500).json({ error: 'Internal error', message: String(error) });
  }
});

// GET /api/metrics/calls/:callId
router.get('/calls/:callId', async (req, res) => {
  try {
    const callId = String(req.params.callId || '').trim();
    if (!callId) {
      return res.status(400).json({ error: 'invalid_call_id' });
    }

    const call = await prisma.callMetric.findUnique({
      where: { callId },
      select: {
        callId: true,
        phoneNumber: true,
        assistantId: true,
        transferNumber: true,
        twilioParentCallSid: true,
        twilioTransferCallSid: true,
        transferStatus: true,
        startedAt: true,
        transferredAt: true,
        endedAt: true,
        durationSec: true,
        postTransferDurationSec: true,
        endedReason: true,
        outcome: true,
        sentiment: true,
        transcript: true,
        transferTranscript: true,
        fullTranscript: true,
        recordingUrl: true,
        transferRecordingUrl: true,
        transferRecordingDurationSec: true,
        recordingsJson: true,
        cost: true,
        inProgress: true,
        lastEventType: true,
        lastEventAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!call) {
      return res.status(404).json({ error: 'call_not_found', callId });
    }

    const attempt = await prisma.callAttempt.findFirst({
      where: { providerId: callId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        leadId: true,
        createdAt: true,
        resultJson: true,
      },
    });

    const attemptResult = asRecord(attempt?.resultJson);
    const selectedAgent = asRecord(attemptResult?.selected_agent);
    const roundRobin = asRecord(attemptResult?.roundRobin);
    const selectedTransferNumber =
      asString(selectedAgent?.transfer_number) ??
      asString(attemptResult?.transferNumber) ??
      asString(attemptResult?.transfer_number) ??
      call.transferNumber ??
      null;
    const humanAgentName =
      asString(selectedAgent?.human_agent_name) ??
      asString(roundRobin?.selectedAgentName) ??
      asString(attemptResult?.humanAgentName) ??
      null;
    const roundRobinEnabled =
      asBoolean(selectedAgent?.round_robin_enabled) ??
      asBoolean(roundRobin?.enabled) ??
      false;
    const roundRobinIndex =
      asNumber(selectedAgent?.round_robin_index) ??
      asNumber(roundRobin?.selectedAgentIndex) ??
      null;
    const roundRobinPoolSize =
      asNumber(selectedAgent?.round_robin_pool_size) ??
      asNumber(roundRobin?.poolSize) ??
      null;
    const answeredAgentName = asString(roundRobin?.answeredAgentName) ?? null;
    const answeredAgentNumber = asString(roundRobin?.answeredAgentNumber) ?? null;
    const answeredAgentIndex = asNumber(roundRobin?.answeredAgentIndex) ?? null;

    const transferFailoverEvents = attempt?.leadId
      ? await prisma.event.findMany({
          where: {
            leadId: attempt.leadId,
            type: 'transfer_failover',
          },
          orderBy: { createdAt: 'asc' },
          select: {
            createdAt: true,
            detail: true,
          },
        })
      : [];

    const failoverSteps = transferFailoverEvents
      .map((event) => {
        const detail = asRecord(event.detail);
        if (!detail) return null;
        if (asString(detail.callId) !== callId) return null;
        return {
          at: event.createdAt,
          reason: asString(detail.reason) ?? null,
          failedAgentIndex: asNumber(detail.failedAgentIndex) ?? null,
          failedAgentName: asString(detail.failedAgentName) ?? null,
          failedAgentNumber: asString(detail.failedAgentNumber) ?? null,
          failedAgentResult: asString(detail.failedAgentResult) ?? asString(detail.reason) ?? null,
          nextIndex: asNumber(detail.nextIndex) ?? null,
          nextAgentName: asString(detail.nextAgentName) ?? null,
          nextTransferNumber: asString(detail.nextTransferNumber) ?? null,
        };
      })
      .filter((x): x is {
        at: Date;
        reason: string | null;
        failedAgentIndex: number | null;
        failedAgentName: string | null;
        failedAgentNumber: string | null;
        failedAgentResult: string | null;
        nextIndex: number | null;
        nextAgentName: string | null;
        nextTransferNumber: string | null;
      } => !!x);
    const firstFailoverStep = failoverSteps.find((step) => step.failedAgentIndex === 0) ?? null;

    const failedAgents = failoverSteps
      .map((step) => ({
        index: step.failedAgentIndex,
        name: step.failedAgentName,
        number: step.failedAgentNumber,
        result: step.failedAgentResult,
      }))
      .filter((agent) => agent.name || agent.number);
    const uniqueFailedAgents = failedAgents.filter((agent, index, arr) => {
      const key = `${agent.index ?? 'na'}|${agent.number ?? ''}|${agent.name ?? ''}|${agent.result ?? ''}`;
      return arr.findIndex((item) => `${item.index ?? 'na'}|${item.number ?? ''}|${item.name ?? ''}|${item.result ?? ''}` === key) === index;
    });
    const firstAgentResult =
      asString(roundRobin?.firstAgentResult) ??
      firstFailoverStep?.failedAgentResult ??
      (answeredAgentIndex === 0 ? 'human-answered' : null);
    const firstAgentName =
      asString(roundRobin?.firstAgentName) ??
      firstFailoverStep?.failedAgentName ??
      (answeredAgentIndex === 0 ? answeredAgentName : null);
    const firstAgentNumber =
      asString(roundRobin?.firstAgentNumber) ??
      firstFailoverStep?.failedAgentNumber ??
      (answeredAgentIndex === 0 ? answeredAgentNumber : null);

    const agentsTriedCount = Math.max(
      1,
      uniqueFailedAgents.length + (answeredAgentName || answeredAgentNumber ? 1 : 0),
      failoverSteps.length + 1,
    );

    const duration = computeDurationSeconds(call.durationSec, call.startedAt, call.endedAt, call.lastEventAt);
    const sellerTalk =
      call.postTransferDurationSec && call.postTransferDurationSec > 0
        ? call.postTransferDurationSec
        : diffSeconds(call.transferredAt, call.endedAt);
    const dataQuality = resolveDataQuality({
      twilioParentCallSid: call.twilioParentCallSid,
      twilioTransferCallSid: call.twilioTransferCallSid,
      transferStatus: call.transferStatus,
      postTransferDurationSec: call.postTransferDurationSec,
      transferRecordingUrl: call.transferRecordingUrl,
      transferTranscript: call.transferTranscript,
    });

    const transferRecordingSource = resolveRecordingSource({
      transferRecordingUrl: call.transferRecordingUrl,
      recordingUrl: call.recordingUrl,
      twilioTransferCallSid: call.twilioTransferCallSid,
    });
    const transferTranscriptSource = resolveTranscriptSource({
      transferTranscript: call.transferTranscript,
      transcript: call.transcript,
      twilioTransferCallSid: call.twilioTransferCallSid,
    });
    const normalized = normalizeMetricClassification({
      outcome: call.outcome,
      sentiment: call.sentiment,
      endedReason: call.endedReason,
      transferredAt: call.transferredAt,
      endedAt: call.endedAt,
      twilioTransferCallSid: call.twilioTransferCallSid,
      transferStatus: call.transferStatus,
      postTransferDurationSec: call.postTransferDurationSec,
    });

    return res.json({
      callId: call.callId,
      phone: maskPhone(call.phoneNumber),
      phoneRaw: call.phoneNumber,
      assistantId: call.assistantId,
      transferNumber: selectedTransferNumber,
      humanAgentName,
      roundRobinEnabled,
      roundRobinIndex,
      roundRobinPoolSize,
      roundRobinAnsweredAgentName: answeredAgentName,
      roundRobinAnsweredAgentNumber: answeredAgentNumber,
      roundRobinAnsweredAgentIndex: answeredAgentIndex,
      roundRobinFirstAgentResult: roundRobinEnabled ? firstAgentResult : null,
      roundRobinFirstAgentName: roundRobinEnabled ? firstAgentName : null,
      roundRobinFirstAgentNumber: roundRobinEnabled ? firstAgentNumber : null,
      roundRobinAgentsTriedCount: roundRobinEnabled ? agentsTriedCount : null,
      roundRobinFailedAgents: roundRobinEnabled ? uniqueFailedAgents : [],
      roundRobinFailoverSteps: roundRobinEnabled ? failoverSteps : [],
      selectionSource: attempt ? 'call_attempt_result_json' : 'call_metric',
      twilioParentCallSid: call.twilioParentCallSid,
      twilioTransferCallSid: call.twilioTransferCallSid,
      transferStatus: call.transferStatus,
      startedAt: call.startedAt,
      transferredAt: call.transferredAt,
      endedAt: call.endedAt,
      durationSec: call.durationSec,
      duration,
      durationSource: durationSource(call.durationSec, call.startedAt, call.endedAt, call.lastEventAt),
      timeToTransferSec: diffSeconds(call.startedAt, call.transferredAt),
      sellerTalkSec: sellerTalk,
      sellerTalkSource: sellerTalkSource(call.postTransferDurationSec, call.transferredAt, call.endedAt),
      postTransferDurationSec: call.postTransferDurationSec,
      endedReason: call.endedReason,
      outcome: normalized.outcome,
      sentiment: normalized.sentiment,
      transcript: call.transcript,
      transferTranscript: call.transferTranscript,
      fullTranscript: call.fullTranscript,
      recordingUrl: call.recordingUrl,
      transferRecordingUrl: call.transferRecordingUrl,
      transferRecordingDurationSec: call.transferRecordingDurationSec,
      transferRecordingSource,
      transferTranscriptSource,
      recordings: call.recordingsJson,
      dataQuality,
      cost: call.cost,
      inProgress: call.inProgress,
      lastEventType: call.lastEventType,
      lastEventAt: call.lastEventAt,
      attemptId: attempt?.id ?? null,
      attemptCreatedAt: attempt?.createdAt ?? null,
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
    });
  } catch (error) {
    console.error('Call detail error:', error);
    return res.status(500).json({ error: 'Internal error', message: String(error) });
  }
});

// POST /api/metrics/calls/:callId/transcribe-full
router.post('/calls/:callId/transcribe-full', async (req, res) => {
  try {
    const callId = String(req.params.callId || '').trim();
    if (!callId) return res.status(400).json({ error: 'invalid_call_id' });
    if (!canTranscribeRecording()) {
      return res.status(400).json({
        error: 'missing_transcription_config',
        message: 'Configure OPENAI_API_KEY or enable local whisper (WHISPER_LOCAL_ENABLED=true).',
      });
    }

    const force = parseBooleanFlag(req.query.force ?? req.body?.force, false);
    const call = await prisma.callMetric.findUnique({
      where: { callId },
      select: {
        callId: true,
        transcript: true,
        transferTranscript: true,
        fullTranscript: true,
        recordingUrl: true,
        transferRecordingUrl: true,
      },
    });
    if (!call) return res.status(404).json({ error: 'call_not_found', callId });

    if (!force && call.fullTranscript && call.fullTranscript.trim()) {
      return res.json({ ok: true, callId, updated: false, reason: 'already_present', fullTranscript: call.fullTranscript });
    }

    const sourceUrl = call.recordingUrl ?? call.transferRecordingUrl;
    if (!sourceUrl) {
      return res.status(400).json({ error: 'missing_recording_url', message: 'No recording URL available for transcription.' });
    }

    const generated = await transcribeRecordingFromUrl(sourceUrl);
    const fallback = composeFullTranscript(call.transcript, call.transferTranscript);
    const nextFullTranscript = generated.text ?? fallback;
    if (!nextFullTranscript) {
      return res.status(422).json({ error: 'transcription_empty', message: 'Transcription did not return text.' });
    }

    await prisma.callMetric.update({
      where: { callId },
      data: { fullTranscript: nextFullTranscript },
    });

    return res.json({
      ok: true,
      callId,
      updated: true,
      source: generated.source ?? 'fallback_compose',
      fullTranscript: nextFullTranscript,
    });
  } catch (error) {
    console.error('Manual full transcription error:', error);
    return res.status(500).json({ error: 'Internal error', message: String(error) });
  }
});

// POST /api/metrics/transcribe-missing
router.post('/transcribe-missing', async (req, res) => {
  try {
    if (!canTranscribeRecording()) {
      return res.status(400).json({
        error: 'missing_transcription_config',
        message: 'Configure OPENAI_API_KEY or enable local whisper (WHISPER_LOCAL_ENABLED=true).',
      });
    }

    const limitRaw = Number(req.query.limit ?? req.body?.limit ?? 30);
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 30, 200));
    const lookbackHoursRaw = Number(req.query.lookback_hours ?? req.body?.lookback_hours ?? 72);
    const lookbackHours = Math.max(1, Math.min(Number.isFinite(lookbackHoursRaw) ? Math.floor(lookbackHoursRaw) : 72, 24 * 14));
    const force = parseBooleanFlag(req.query.force ?? req.body?.force, false);
    const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    const candidates = await prisma.callMetric.findMany({
      where: {
        outcome: 'transfer_success',
        updatedAt: { gte: cutoff },
        OR: [
          { fullTranscript: null },
          { fullTranscript: '' },
        ],
        AND: [
          {
            OR: [
              { recordingUrl: { not: null } },
              { transferRecordingUrl: { not: null } },
            ],
          },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        callId: true,
        transcript: true,
        transferTranscript: true,
        fullTranscript: true,
        recordingUrl: true,
        transferRecordingUrl: true,
      },
    });

    const results: Array<{
      callId: string;
      status: 'updated' | 'skipped' | 'failed';
      source?: 'openai_audio_transcription' | 'local_whisper_transcription' | 'fallback_compose';
      reason?: string;
    }> = [];

    for (const call of candidates) {
      try {
        if (!force && call.fullTranscript && call.fullTranscript.trim()) {
          results.push({ callId: call.callId, status: 'skipped', reason: 'already_present' });
          continue;
        }
        const sourceUrl = call.recordingUrl ?? call.transferRecordingUrl;
        if (!sourceUrl) {
          results.push({ callId: call.callId, status: 'skipped', reason: 'missing_recording_url' });
          continue;
        }
        const generated = await transcribeRecordingFromUrl(sourceUrl);
        const fallback = composeFullTranscript(call.transcript, call.transferTranscript);
        const nextFullTranscript = generated.text ?? fallback;
        if (!nextFullTranscript) {
          results.push({ callId: call.callId, status: 'failed', reason: 'transcription_empty' });
          continue;
        }
        await prisma.callMetric.update({
          where: { callId: call.callId },
          data: { fullTranscript: nextFullTranscript },
        });
        results.push({
          callId: call.callId,
          status: 'updated',
          source: generated.source ?? 'fallback_compose',
        });
      } catch (error) {
        results.push({ callId: call.callId, status: 'failed', reason: String(error) });
      }
    }

    return res.json({
      ok: true,
      limit,
      lookbackHours,
      processed: candidates.length,
      updated: results.filter((r) => r.status === 'updated').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
    });
  } catch (error) {
    console.error('Bulk missing transcription error:', error);
    return res.status(500).json({ error: 'Internal error', message: String(error) });
  }
});

// POST /api/metrics/calls/:callId/sync
router.post('/calls/:callId/sync', async (req, res) => {
  try {
    const callId = String(req.params.callId || '').trim();
    if (!callId) {
      return res.status(400).json({ error: 'invalid_call_id' });
    }

    const apiKey = asString(req.body?.vapi_api_key) || VAPI_API_KEY;
    const force = parseBooleanFlag(req.query.force ?? req.body?.force, false);
    if (!apiKey) {
      return res.status(400).json({
        error: 'missing_vapi_config',
        message: 'VAPI_API_KEY is required (env or request body vapi_api_key).',
      });
    }

    const metric = await prisma.callMetric.findUnique({
      where: { callId },
      select: {
        callId: true,
        phoneNumber: true,
        assistantId: true,
        transferNumber: true,
        startedAt: true,
        transferredAt: true,
        endedAt: true,
        durationSec: true,
        endedReason: true,
        transcript: true,
        transferTranscript: true,
        fullTranscript: true,
        recordingUrl: true,
        transferRecordingUrl: true,
        transferRecordingDurationSec: true,
        twilioParentCallSid: true,
        twilioTransferCallSid: true,
        transferStatus: true,
        postTransferDurationSec: true,
        cost: true,
      },
    });
    if (!metric) {
      return res.status(404).json({ error: 'call_not_found', callId });
    }

    const vapiResponse = await fetch(`https://api.vapi.ai/call/${callId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const payload = await vapiResponse.json().catch(() => ({}));
    if (!vapiResponse.ok) {
      return res.status(502).json({
        error: 'vapi_call_lookup_failed',
        status: vapiResponse.status,
        message: asString(asRecord(payload)?.message) || 'lookup failed',
      });
    }

    const snapshot = extractCallSnapshotFromVapiPayload(payload);
    if (!snapshot) {
      return res.status(422).json({ error: 'invalid_vapi_payload', message: 'No call snapshot found in Vapi response.' });
    }

    const patch = force
      ? {
          phoneNumber: snapshot.phoneNumber ?? metric.phoneNumber,
          assistantId: snapshot.assistantId ?? metric.assistantId,
          transferNumber: snapshot.transferNumber ?? metric.transferNumber,
          startedAt: snapshot.startedAt ?? metric.startedAt,
          transferredAt: snapshot.transferredAt ?? metric.transferredAt,
          endedAt: snapshot.endedAt ?? metric.endedAt,
          durationSec: snapshot.durationSec ?? metric.durationSec,
          endedReason: snapshot.endedReason ?? metric.endedReason,
          transcript: snapshot.transcript ?? metric.transcript,
          recordingUrl: snapshot.recordingUrl ?? metric.recordingUrl,
          cost: snapshot.cost ?? metric.cost,
        }
      : buildMetricPatch(metric, snapshot);

    if (Object.keys(patch).length) {
      await prisma.callMetric.update({
        where: { callId },
        data: patch,
      });
    }

    // Twilio enrichment for transfer leg recording/transcript, used by dashboard "sync this call".
    if (canUseTwilioSync()) {
      let nextChildCallSid = metric.twilioTransferCallSid;
      if (!nextChildCallSid && metric.twilioParentCallSid) {
        const childCalls = await fetchTwilioChildCalls(metric.twilioParentCallSid);
        const picked = pickTransferChild(childCalls, metric.transferNumber ?? snapshot.transferNumber ?? null);
        nextChildCallSid = asString(picked?.sid) ?? null;
      }

      if (nextChildCallSid) {
        const rec = await fetchTwilioLatestRecording(nextChildCallSid);
        if (rec.recordingUrl) {
          const nextTransferTranscript =
            metric.transferTranscript ||
            (canTranscribeRecording()
              ? (await transcribeRecordingFromUrl(rec.recordingUrl)).text
              : null);
          const nextFullTranscript = composeFullTranscript(
            metric.transcript ?? snapshot.transcript ?? null,
            nextTransferTranscript
          );

          await prisma.callMetric.update({
            where: { callId },
            data: {
              twilioTransferCallSid: nextChildCallSid,
              transferRecordingUrl: rec.recordingUrl,
              transferRecordingDurationSec: rec.recordingDurationSec ?? metric.transferRecordingDurationSec ?? undefined,
              postTransferDurationSec: rec.recordingDurationSec ?? metric.postTransferDurationSec ?? undefined,
              transferTranscript: nextTransferTranscript ?? undefined,
              fullTranscript: nextFullTranscript ?? undefined,
              transferStatus: metric.transferStatus ?? 'completed',
              lastEventType: 'manual-sync-twilio-transfer-recording',
              lastEventAt: new Date(),
            },
          });
        }
      }
    }

    const updatedMetric = await prisma.callMetric.findUnique({
      where: { callId },
      select: {
        callId: true,
        transcript: true,
        recordingUrl: true,
        durationSec: true,
        startedAt: true,
        endedAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      ok: true,
      callId,
      force,
      updated: Object.keys(patch).length > 0,
      updatedFields: Object.keys(patch),
      metric: updatedMetric,
    });
  } catch (error) {
    console.error('Call sync error:', error);
    return res.status(500).json({ error: 'Internal error', message: String(error) });
  }
});

// POST /api/metrics/backfill
router.post('/backfill', async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit ?? req.body?.limit ?? DEFAULT_BACKFILL_LIMIT);
    const onlyMissing = parseBooleanFlag(req.query.onlyMissing ?? req.body?.onlyMissing, true);
    const dryRun = parseBooleanFlag(req.query.dryRun ?? req.body?.dryRun, false);
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_BACKFILL_LIMIT, MAX_BACKFILL_LIMIT));
    const apiKey = asString(req.body?.vapi_api_key) || VAPI_API_KEY;

    if (!apiKey) {
      return res.status(400).json({
        error: 'missing_vapi_config',
        message: 'VAPI_API_KEY is required (env or request body vapi_api_key).',
      });
    }

    const batch = await runBackfillBatch({
      apiKey,
      limit,
      onlyMissing,
      dryRun,
    });

    return res.json({
      ok: true,
      ...batch,
      errors: batch.errors.slice(0, 50),
    });
  } catch (error) {
    console.error('Backfill error:', error);
    return res.status(500).json({ error: 'Internal error', message: String(error) });
  }
});

// POST /api/metrics/backfill/run
router.post('/backfill/run', async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit ?? req.body?.limit ?? DEFAULT_BACKFILL_LIMIT);
    const maxBatchesRaw = Number(req.query.maxBatches ?? req.body?.maxBatches ?? 10);
    const dryRun = parseBooleanFlag(req.query.dryRun ?? req.body?.dryRun, false);
    const onlyMissing = parseBooleanFlag(req.query.onlyMissing ?? req.body?.onlyMissing, true);
    const stopWhenNoUpdates = parseBooleanFlag(req.query.stopWhenNoUpdates ?? req.body?.stopWhenNoUpdates, true);
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_BACKFILL_LIMIT, MAX_BACKFILL_LIMIT));
    const maxBatches = Math.max(1, Math.min(Number.isFinite(maxBatchesRaw) ? Math.floor(maxBatchesRaw) : 10, 100));
    const apiKey = asString(req.body?.vapi_api_key) || VAPI_API_KEY;

    if (!apiKey) {
      return res.status(400).json({
        error: 'missing_vapi_config',
        message: 'VAPI_API_KEY is required (env or request body vapi_api_key).',
      });
    }

    const seenCallIds = new Set<string>();
    const batches: Array<Omit<BackfillBatchResult, 'processedCallIds'>> = [];
    let totalSelected = 0;
    let totalAttempted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    const allErrors: BackfillError[] = [];

    const plannedBatches = dryRun ? 1 : maxBatches;
    for (let i = 0; i < plannedBatches; i++) {
      const batch = await runBackfillBatch({
        apiKey,
        limit,
        onlyMissing,
        dryRun,
        excludeCallIds: Array.from(seenCallIds),
      });

      for (const callId of batch.processedCallIds) seenCallIds.add(callId);
      totalSelected += batch.selected;
      totalAttempted += batch.attempted;
      totalUpdated += batch.updated;
      totalSkipped += batch.skipped;
      allErrors.push(...batch.errors);
      batches.push({
        dryRun: batch.dryRun,
        onlyMissing: batch.onlyMissing,
        limit: batch.limit,
        selected: batch.selected,
        attempted: batch.attempted,
        updated: batch.updated,
        skipped: batch.skipped,
        errors: batch.errors.slice(0, 20),
      });

      if (batch.selected === 0) break;
      if (stopWhenNoUpdates && batch.updated === 0) break;
    }

    return res.json({
      ok: true,
      mode: 'run',
      dryRun,
      onlyMissing,
      limit,
      maxBatches: plannedBatches,
      executedBatches: batches.length,
      totals: {
        selected: totalSelected,
        attempted: totalAttempted,
        updated: totalUpdated,
        skipped: totalSkipped,
      },
      batches,
      errors: allErrors.slice(0, 100),
    });
  } catch (error) {
    console.error('Backfill run error:', error);
    return res.status(500).json({ error: 'Internal error', message: String(error) });
  }
});

function maskPhone(phone: string): string {
  if (phone.length < 8) return phone;
  // Try to preserve country code
  const parts = phone.replace(/[^\d+]/g, '').match(/^(\+?\d{2,3})(\d*)(\d{4})$/);
  if (parts) {
    return `${parts[1]} **** ${parts[3]}`;
  }
  return phone.slice(0, -8) + ' **** ' + phone.slice(-4);
}

function formatRelativeTime(date: Date | null): string {
  if (!date) return '--';
  const diff = Date.now() - date.getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'hace segundos';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  return `hace ${Math.floor(hours / 24)}d`;
}

function diffSeconds(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return Math.round(diffMs / 1000);
}

function computeDurationSeconds(durationSec: number | null, startedAt: Date | null, endedAt: Date | null, lastEventAt: Date | null): number {
  if (durationSec !== null && durationSec > 0) return durationSec;
  const direct = diffSeconds(startedAt, endedAt);
  if (direct !== null && direct > 0) return direct;
  const byLastEvent = diffSeconds(startedAt, lastEventAt);
  if (byLastEvent !== null && byLastEvent > 0) return byLastEvent;
  return 0;
}

function durationSource(durationSec: number | null, startedAt: Date | null, endedAt: Date | null, lastEventAt: Date | null): 'duration_sec' | 'timestamp_fallback' | 'missing' {
  if (durationSec !== null && durationSec > 0) return 'duration_sec';
  const fallback = diffSeconds(startedAt, endedAt);
  if (fallback !== null && fallback > 0) return 'timestamp_fallback';
  const lastEventFallback = diffSeconds(startedAt, lastEventAt);
  if (lastEventFallback !== null && lastEventFallback > 0) return 'timestamp_fallback';
  return 'missing';
}

function sellerTalkSource(postTransferDurationSec: number | null, transferredAt: Date | null, endedAt: Date | null): 'post_transfer_duration_sec' | 'timestamp_fallback' | 'missing' {
  if (postTransferDurationSec !== null && postTransferDurationSec > 0) return 'post_transfer_duration_sec';
  const fallback = diffSeconds(transferredAt, endedAt);
  if (fallback !== null && fallback > 0) return 'timestamp_fallback';
  return 'missing';
}

function looksLikeTransferEndedReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const normalized = reason.toLowerCase();
  return normalized.includes('forward') || normalized.includes('transfer');
}

function normalizeMetricClassification(input: {
  outcome: string | null;
  sentiment: string | null;
  endedReason: string | null;
  transferredAt: Date | null;
  endedAt: Date | null;
  twilioTransferCallSid: string | null;
  transferStatus: string | null;
  postTransferDurationSec: number | null;
}) {
  const transferStatus = (input.transferStatus || '').toLowerCase();
  const timeAfterTransferSec = diffSeconds(input.transferredAt, input.endedAt) ?? 0;
  const hasConnectedTransfer =
    (input.postTransferDurationSec ?? 0) > 0 ||
    CONNECTED_TRANSFER_STATUSES.has(transferStatus) ||
    (!!input.transferredAt && timeAfterTransferSec > 0);
  const transferAttempted =
    hasConnectedTransfer ||
    !!input.twilioTransferCallSid ||
    !!input.transferredAt ||
    !!input.transferStatus ||
    looksLikeTransferEndedReason(input.endedReason) ||
    input.outcome === 'transfer_success';

  let outcome = input.outcome ?? 'completed';
  if (hasConnectedTransfer) {
    outcome = 'transfer_success';
  } else if (outcome === 'transfer_success' && !transferAttempted) {
    outcome = 'completed';
  }

  let sentiment = input.sentiment ?? 'neutral';
  if (outcome === 'transfer_success') sentiment = 'positive';
  else if (outcome === 'abandoned' || outcome === 'failed') sentiment = 'negative';
  else if (!sentiment || sentiment === 'negative') sentiment = 'neutral';

  return {
    outcome,
    sentiment,
    hasConnectedTransfer,
    transferAttempted,
  };
}

type DataSource = 'twilio' | 'vapi' | 'missing';

function resolveRecordingSource(input: {
  transferRecordingUrl: string | null;
  recordingUrl: string | null;
  twilioTransferCallSid: string | null;
}): DataSource {
  // If we have a transfer-specific recording URL and Twilio child call, it's from Twilio
  if (input.transferRecordingUrl && input.twilioTransferCallSid) {
    // Check if URL contains twilio domain
    if (input.transferRecordingUrl.includes('twilio') || input.transferRecordingUrl.includes('api.twilio')) {
      return 'twilio';
    }
  }
  // If we have transferRecordingUrl (could be from VAPI's end-of-call-report)
  if (input.transferRecordingUrl) {
    return 'vapi';
  }
  // If we have general recordingUrl from VAPI
  if (input.recordingUrl) {
    return 'vapi';
  }
  return 'missing';
}

function resolveTranscriptSource(input: {
  transferTranscript: string | null;
  transcript: string | null;
  twilioTransferCallSid: string | null;
}): DataSource {
  // If we have a transfer-specific transcript and Twilio child call, check origin
  if (input.transferTranscript && input.twilioTransferCallSid) {
    // Twilio transcription is typically shorter and comes from their STT
    // For now, we assume transferTranscript from our DB is VAPI-sourced unless we add metadata
    // In the future, we could store a source field directly
    return 'vapi'; // Default to vapi since VAPI sends transcript in end-of-call-report
  }
  // If we have transferTranscript without Twilio context
  if (input.transferTranscript) {
    return 'vapi';
  }
  // If we have general transcript from VAPI
  if (input.transcript) {
    return 'vapi';
  }
  return 'missing';
}

function resolveDataQuality(input: {
  twilioParentCallSid: string | null;
  twilioTransferCallSid: string | null;
  transferStatus: string | null;
  postTransferDurationSec: number | null;
  transferRecordingUrl: string | null;
  transferTranscript: string | null;
}) {
  const hasTwilioPolledData =
    !!input.twilioParentCallSid &&
    (!!input.twilioTransferCallSid || !!input.transferStatus || (input.postTransferDurationSec ?? 0) > 0);
  const hasFullLegData =
    hasTwilioPolledData &&
    !!input.transferRecordingUrl &&
    !!input.transferTranscript;
  return {
    mode: hasFullLegData ? 'full_leg_control' : hasTwilioPolledData ? 'twilio_polled' : 'vapi_only',
    hasTwilioPolledData,
    hasFullLegData,
  };
}

export default router;
