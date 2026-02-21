/**
 * Dashboard metrics API endpoints
 * Provides summary, daily trends, and recent calls data
 */

import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

const router = Router();
// Minimum duration (seconds) for a transfer to count as "connected"
// Previously 35s, lowered to 10s since VAPI transfers are quick
const TRANSFER_CONNECTED_MIN_SEC = Number(process.env.TRANSFER_CONNECTED_MIN_SEC ?? 10);

// Helper: Get date range for period
function getPeriodDates(period: string) {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  const subDays = (d: Date, n: number) => new Date(d.getTime() - n * 24 * 60 * 60 * 1000);
  
  let startDate: Date, endDate: Date, prevStartDate: Date, prevEndDate: Date;
  
  switch (period) {
    case 'Ayer':
      startDate = startOfDay(subDays(now, 1));
      endDate = endOfDay(subDays(now, 1));
      prevStartDate = startOfDay(subDays(now, 2));
      prevEndDate = endOfDay(subDays(now, 2));
      break;
    case '7 días':
      startDate = startOfDay(subDays(now, 7));
      endDate = now;
      prevStartDate = startOfDay(subDays(now, 14));
      prevEndDate = startOfDay(subDays(now, 7));
      break;
    case '30 días':
      startDate = startOfDay(subDays(now, 30));
      endDate = now;
      prevStartDate = startOfDay(subDays(now, 60));
      prevEndDate = startOfDay(subDays(now, 30));
      break;
    default: // Hoy
      startDate = startOfDay(now);
      endDate = now;
      prevStartDate = startOfDay(subDays(now, 1));
      prevEndDate = endOfDay(subDays(now, 1));
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
        where: {
          startedAt: { gte: startDate, lt: endDate },
          outcome: 'transfer_success',
          durationSec: { gte: TRANSFER_CONNECTED_MIN_SEC },
        },
      }),
      prisma.callMetric.count({
        where: {
          startedAt: { gte: prevStartDate, lt: prevEndDate },
          outcome: 'transfer_success',
          durationSec: { gte: TRANSFER_CONNECTED_MIN_SEC },
        },
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
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    
    const calls = await prisma.callMetric.findMany({
      where: { startedAt: { gte: startDate } },
      select: { startedAt: true, outcome: true },
    });
    
    // Group by day
    const dayMap = new Map<string, { calls: number; transfers: number; abandoned: number }>();
    
    for (const call of calls) {
      if (!call.startedAt) continue;
      
      const dateKey = call.startedAt.toISOString().split('T')[0];
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
    
    const today = new Date().toISOString().split('T')[0];
    
    const result = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        day: date === today ? 'Hoy' : dayNames[new Date(date + 'T12:00:00').getDay()],
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
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        phoneNumber: true,
        outcome: true,
        sentiment: true,
        durationSec: true,
        createdAt: true,
        inProgress: true,
      },
    });
    
    res.json(calls.map((c: any) => ({
      phone: maskPhone(c.phoneNumber),
      outcome: c.outcome,
      sentiment: c.sentiment,
      duration: c.durationSec,
      ago: formatRelativeTime(c.createdAt),
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

function formatRelativeTime(date: Date): string {
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
