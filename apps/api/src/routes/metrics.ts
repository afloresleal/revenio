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
    
    const where: { sentiment?: string; outcome?: string; phoneNumber?: { contains: string } } = {};
    if (sentiment && sentiment !== 'all') where.sentiment = sentiment;
    if (outcome && outcome !== 'all') where.outcome = outcome;
    if (search) where.phoneNumber = { contains: search };
    
    const calls = await prisma.callMetric.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        phoneNumber: true,
        outcome: true,
        sentiment: true,
        durationSec: true,
        startedAt: true,
        createdAt: true,
        inProgress: true,
      },
    });
    
    res.json(calls.map((c: any) => ({
      phone: maskPhone(c.phoneNumber),
      outcome: c.outcome,
      sentiment: c.sentiment,
      duration: c.durationSec,
      ago: formatRelativeTime(c.startedAt ?? c.createdAt),
      inProgress: c.inProgress,
    })));
  } catch (error) {
    console.error('Recent error:', error);
    res.status(500).json({ error: 'Internal error', message: String(error) });
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

export default router;
