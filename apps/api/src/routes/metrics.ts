/**
 * Dashboard metrics API endpoints
 * Provides summary, daily trends, and recent calls data
 */

import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

const router = Router();
// Minimum duration fallback for transfer connection heuristic.
// Some providers report duration=0 even when transfer is successful.
const TRANSFER_CONNECTED_MIN_SEC = Number(process.env.TRANSFER_CONNECTED_MIN_SEC ?? 10);
const DASHBOARD_TIMEZONE = 'America/Mexico_City';
const DEFAULT_BACKFILL_LIMIT = Number(process.env.METRICS_BACKFILL_LIMIT ?? 100);
const MAX_BACKFILL_LIMIT = Number(process.env.METRICS_BACKFILL_MAX_LIMIT ?? 500);
const VAPI_API_KEY = process.env.VAPI_API_KEY ?? '';

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
    
    const connectedTransferWhereCurrent = {
      startedAt: { gte: startDate, lt: endDate },
      outcome: 'transfer_success',
      OR: [
        { transferredAt: { not: null } },
        { durationSec: { gte: TRANSFER_CONNECTED_MIN_SEC } },
        { endedReason: { contains: 'forward', mode: 'insensitive' as const } },
        { endedReason: { contains: 'transfer', mode: 'insensitive' as const } },
      ],
    };
    const connectedTransferWherePrevious = {
      startedAt: { gte: prevStartDate, lt: prevEndDate },
      outcome: 'transfer_success',
      OR: [
        { transferredAt: { not: null } },
        { durationSec: { gte: TRANSFER_CONNECTED_MIN_SEC } },
        { endedReason: { contains: 'forward', mode: 'insensitive' as const } },
        { endedReason: { contains: 'transfer', mode: 'insensitive' as const } },
      ],
    };

    // Group by outcome and sentiment
    const [outcomes, sentiments, inProgress, connectedTransfers, prevConnectedTransfers, prevOutcomes] = await Promise.all([
      prisma.callMetric.groupBy({
        by: ['outcome'],
        where: { startedAt: { gte: startDate, lt: endDate } },
        _count: { _all: true },
      }),
      prisma.callMetric.groupBy({
        by: ['sentiment'],
        where: { startedAt: { gte: startDate, lt: endDate } },
        _count: { _all: true },
      }),
      prisma.callMetric.count({
        where: { inProgress: true },
      }),
      prisma.callMetric.count({
        where: connectedTransferWhereCurrent,
      }),
      prisma.callMetric.count({
        where: connectedTransferWherePrevious,
      }),
      prisma.callMetric.groupBy({
        by: ['outcome'],
        where: { startedAt: { gte: prevStartDate, lt: prevEndDate } },
        _count: { _all: true },
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
    
    // Aggregate outcomes
    const outcomeMap = Object.fromEntries(outcomes.map((o: any) => [o.outcome, o._count._all])) as Record<string, number>;
    const prevOutcomeMap = Object.fromEntries(prevOutcomes.map((o: any) => [o.outcome, o._count._all])) as Record<string, number>;
    const sentimentMap = Object.fromEntries(sentiments.map((s: any) => [s.sentiment, s._count._all])) as Record<string, number>;
    
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
      select: { startedAt: true, outcome: true },
    });
    
    // Group by day
    const dayMap = new Map<string, { calls: number; transfers: number; abandoned: number }>();
    
    for (const call of calls) {
      if (!call.startedAt) continue;
      
      const dateKey = getDateKeyInTimezone(call.startedAt);
      const entry = dayMap.get(dateKey) || { calls: 0, transfers: 0, abandoned: 0 };
      
      entry.calls++;
      if (call.outcome === 'transfer_success') entry.transfers++;
      if (call.outcome === 'abandoned') entry.abandoned++;
      
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
        outcome: true,
        sentiment: true,
        durationSec: true,
        postTransferDurationSec: true,
        startedAt: true,
        transferredAt: true,
        endedAt: true,
        createdAt: true,
        inProgress: true,
      },
    });
    
    res.json(calls.map((c: any) => {
      const duration = c.durationSec && c.durationSec > 0 ? c.durationSec : diffSeconds(c.startedAt, c.endedAt);
      const sellerTalk =
        c.postTransferDurationSec && c.postTransferDurationSec > 0
          ? c.postTransferDurationSec
          : diffSeconds(c.transferredAt, c.endedAt);
      return {
        callId: c.callId,
        phone: maskPhone(c.phoneNumber),
        assistantId: c.assistantId,
        transferNumber: c.transferNumber,
        outcome: c.outcome,
        sentiment: c.sentiment,
        duration,
        durationSource: durationSource(c.durationSec, c.startedAt, c.endedAt),
        startedAt: c.startedAt,
        transferredAt: c.transferredAt,
        endedAt: c.endedAt,
        timeToTransferSec: diffSeconds(c.startedAt, c.transferredAt),
        sellerTalkSec: sellerTalk,
        sellerTalkSource: sellerTalkSource(c.postTransferDurationSec, c.transferredAt, c.endedAt),
        postTransferDurationSec: c.postTransferDurationSec,
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
        startedAt: true,
        transferredAt: true,
        endedAt: true,
        durationSec: true,
        postTransferDurationSec: true,
        endedReason: true,
        outcome: true,
        sentiment: true,
        transcript: true,
        recordingUrl: true,
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

    const duration = call.durationSec && call.durationSec > 0 ? call.durationSec : diffSeconds(call.startedAt, call.endedAt);
    const sellerTalk =
      call.postTransferDurationSec && call.postTransferDurationSec > 0
        ? call.postTransferDurationSec
        : diffSeconds(call.transferredAt, call.endedAt);

    return res.json({
      callId: call.callId,
      phone: maskPhone(call.phoneNumber),
      phoneRaw: call.phoneNumber,
      assistantId: call.assistantId,
      transferNumber: call.transferNumber,
      startedAt: call.startedAt,
      transferredAt: call.transferredAt,
      endedAt: call.endedAt,
      durationSec: call.durationSec,
      duration,
      durationSource: durationSource(call.durationSec, call.startedAt, call.endedAt),
      timeToTransferSec: diffSeconds(call.startedAt, call.transferredAt),
      sellerTalkSec: sellerTalk,
      sellerTalkSource: sellerTalkSource(call.postTransferDurationSec, call.transferredAt, call.endedAt),
      postTransferDurationSec: call.postTransferDurationSec,
      endedReason: call.endedReason,
      outcome: call.outcome,
      sentiment: call.sentiment,
      transcript: call.transcript,
      recordingUrl: call.recordingUrl,
      cost: call.cost,
      inProgress: call.inProgress,
      lastEventType: call.lastEventType,
      lastEventAt: call.lastEventAt,
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
    });
  } catch (error) {
    console.error('Call detail error:', error);
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

function durationSource(durationSec: number | null, startedAt: Date | null, endedAt: Date | null): 'duration_sec' | 'timestamp_fallback' | 'missing' {
  if (durationSec !== null && durationSec > 0) return 'duration_sec';
  const fallback = diffSeconds(startedAt, endedAt);
  if (fallback !== null && fallback > 0) return 'timestamp_fallback';
  return 'missing';
}

function sellerTalkSource(postTransferDurationSec: number | null, transferredAt: Date | null, endedAt: Date | null): 'post_transfer_duration_sec' | 'timestamp_fallback' | 'missing' {
  if (postTransferDurationSec !== null && postTransferDurationSec > 0) return 'post_transfer_duration_sec';
  const fallback = diffSeconds(transferredAt, endedAt);
  if (fallback !== null && fallback > 0) return 'timestamp_fallback';
  return 'missing';
}

export default router;
