/**
 * Background jobs for async processing
 * - sync-transfer-metrics: Update postTransferDurationSec from Twilio child calls
 */

import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

const router = Router();

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? '';
const VAPI_API_KEY = process.env.VAPI_API_KEY ?? '';
const SYNC_TRANSFER_DEFAULT_LOOKBACK_MIN = Number(process.env.SYNC_TRANSFER_DEFAULT_LOOKBACK_MIN ?? 180);

interface TwilioCall {
  sid: string;
  to: string;
  from: string;
  status: string;
  duration: string;
  start_time?: string;
  end_time?: string;
  parent_call_sid?: string | null;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return false;
}

interface TwilioCallsResponse {
  calls: TwilioCall[];
}

interface TwilioCallDetail {
  sid?: string;
  duration?: string;
}

function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const keepPlus = value.trim().startsWith('+');
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return null;
  return keepPlus ? `+${digits}` : digits;
}

function pickTransferChild(calls: TwilioCall[], expectedTransferNumber: string | null | undefined): TwilioCall | null {
  const normalizedExpected = normalizePhone(expectedTransferNumber);
  const ranked = calls
    .map((c) => {
      const durationSec = Number.parseInt(c.duration ?? '0', 10);
      const normalizedTo = normalizePhone(c.to);
      const score =
        (normalizedExpected && normalizedTo && normalizedExpected === normalizedTo ? 10 : 0) +
        (Number.isFinite(durationSec) && durationSec > 0 ? 3 : 0) +
        (c.status === 'completed' ? 1 : 0);
      return { call: c, score };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.call ?? null;
}

/**
 * Fetch child calls from Twilio by parent CallSid
 */
async function fetchTwilioChildCalls(parentCallSid: string): Promise<TwilioCall[]> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.log('sync-transfer-metrics: Missing Twilio credentials');
    return [];
  }

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json?ParentCallSid=${parentCallSid}`;

  try {
    const resp = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}` }
    });

    if (!resp.ok) {
      console.warn('sync-transfer-metrics: Twilio API error', { status: resp.status, parentCallSid });
      return [];
    }

    const data = await resp.json() as TwilioCallsResponse;
    return data.calls || [];
  } catch (error) {
    console.error('sync-transfer-metrics: Twilio fetch error', { error: String(error), parentCallSid });
    return [];
  }
}

async function fetchTwilioCallDuration(callSid: string): Promise<number | null> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !callSid) return null;

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${encodeURIComponent(callSid)}.json`;

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as TwilioCallDetail;
    const durationSec = data.duration ? Number.parseInt(data.duration, 10) : NaN;
    return Number.isFinite(durationSec) && durationSec >= 0 ? durationSec : null;
  } catch {
    return null;
  }
}

/**
 * Get Twilio CallSid from VAPI call
 */
async function getVapiCallTwilioSid(vapiCallId: string): Promise<string | null> {
  if (!VAPI_API_KEY) return null;

  try {
    const resp = await fetch(`https://api.vapi.ai/call/${vapiCallId}`, {
      headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` }
    });

    if (!resp.ok) return null;

    const data = await resp.json();
    return data.phoneCallProviderId || null;
  } catch {
    return null;
  }
}

/**
 * POST /api/jobs/sync-transfer-metrics
 * 
 * Finds calls with:
 * - outcome = 'transfer_success'
 * - postTransferDurationSec IS NULL or 0
 *   OR transfer metadata is incomplete (transferNumber/transferredAt)
 * - ended in last 24 hours
 * 
 * For each, fetches Twilio child call duration and updates the metric.
 */
router.post('/sync-transfer-metrics', async (req, res) => {
  const dryRun = parseBoolean(req.query.dry_run ?? req.body?.dry_run);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const lookbackMinutesRaw = Number(req.query.lookback_minutes ?? req.body?.lookback_minutes ?? SYNC_TRANSFER_DEFAULT_LOOKBACK_MIN);
  const lookbackMinutes = Math.max(5, Math.min(Number.isFinite(lookbackMinutesRaw) ? Math.floor(lookbackMinutesRaw) : SYNC_TRANSFER_DEFAULT_LOOKBACK_MIN, 7 * 24 * 60));
  
  // Find calls needing sync
  const cutoff = new Date(Date.now() - lookbackMinutes * 60 * 1000);
  
  const callsToSync = await prisma.callMetric.findMany({
    where: {
      outcome: 'transfer_success',
      AND: [
        {
          OR: [
            { postTransferDurationSec: null },
            { postTransferDurationSec: 0 },
            { transferNumber: null },
            { transferredAt: null },
            { transferStatus: null },
            { twilioParentCallSid: null },
            { twilioTransferCallSid: null },
          ],
        },
        {
          OR: [
            { endedAt: { gte: cutoff } },
            { updatedAt: { gte: cutoff } },
          ],
        },
      ]
    },
    orderBy: { endedAt: 'desc' },
    take: limit
  });

  console.log('sync-transfer-metrics: Found calls to sync', { count: callsToSync.length, dryRun, lookbackMinutes });

  const results: Array<{
    callId: string;
    status: 'updated' | 'no_child' | 'not_completed' | 'no_twilio_sid' | 'error';
    postTransferDurationSec?: number;
    totalDurationSec?: number;
    transferStatus?: string;
    parentCallSid?: string;
    childCallSid?: string;
    error?: string;
  }> = [];

  for (const call of callsToSync) {
    try {
      // Get Twilio parent CallSid from DB first, then VAPI fallback
      const twilioParentSid = call.twilioParentCallSid ?? await getVapiCallTwilioSid(call.callId);
      
      if (!twilioParentSid) {
        results.push({ callId: call.callId, status: 'no_twilio_sid' });
        continue;
      }

      const twilioTotalDurationSec = await fetchTwilioCallDuration(twilioParentSid);

      // Fetch child calls
      const childCalls = await fetchTwilioChildCalls(twilioParentSid);

      // Find transfer leg (prioritize expected transfer number if present)
      const transferChild = pickTransferChild(childCalls, call.transferNumber);
      const postTransferDurationSec = transferChild ? parseInt(transferChild.duration ?? '0', 10) : null;
      const transferNumberFromTwilio = transferChild?.to ?? null;
      const transferredAtFromTwilio = transferChild?.start_time ? new Date(transferChild.start_time) : null;
      const transferStatusFromTwilio = transferChild?.status ?? null;

      if (!dryRun) {
        const nextDurationSec =
          twilioTotalDurationSec !== null && twilioTotalDurationSec > (call.durationSec ?? 0)
            ? twilioTotalDurationSec
            : call.durationSec;
        const validTransferredAt =
          transferredAtFromTwilio && !Number.isNaN(transferredAtFromTwilio.getTime())
            ? transferredAtFromTwilio
            : call.transferredAt;
        await prisma.callMetric.update({
          where: { callId: call.callId },
          data: {
            twilioParentCallSid: twilioParentSid,
            twilioTransferCallSid: transferChild?.sid ?? call.twilioTransferCallSid ?? undefined,
            transferStatus: transferStatusFromTwilio ?? call.transferStatus ?? undefined,
            postTransferDurationSec: postTransferDurationSec ?? undefined,
            durationSec: nextDurationSec ?? undefined,
            transferNumber: transferNumberFromTwilio ?? call.transferNumber ?? undefined,
            transferredAt: validTransferredAt ?? undefined,
          }
        });
        await prisma.twilioCallLink.upsert({
          where: { parentCallSid: twilioParentSid },
          create: {
            parentCallSid: twilioParentSid,
            childCallSid: transferChild?.sid ?? null,
            vapiCallId: call.callId,
            childStatus: transferStatusFromTwilio ?? null,
            lastCallbackAt: new Date(),
          },
          update: {
            childCallSid: transferChild?.sid ?? undefined,
            vapiCallId: call.callId,
            childStatus: transferStatusFromTwilio ?? undefined,
            lastCallbackAt: new Date(),
          },
        });
      }

      let status: 'updated' | 'no_child' | 'not_completed' = 'updated';
      const hasAnyDuration = postTransferDurationSec !== null || twilioTotalDurationSec !== null;
      if (!hasAnyDuration) {
        if (childCalls.length === 0) status = 'no_child';
        else if (!transferChild) status = 'not_completed';
      }

      results.push({
        callId: call.callId,
        status,
        postTransferDurationSec: postTransferDurationSec ?? undefined,
        totalDurationSec: twilioTotalDurationSec ?? undefined,
        transferStatus: transferStatusFromTwilio ?? undefined,
        parentCallSid: twilioParentSid,
        childCallSid: transferChild?.sid
      });

      console.log('sync-transfer-metrics: Updated call', {
        callId: call.callId,
        postTransferDurationSec: postTransferDurationSec,
        totalDurationSec: twilioTotalDurationSec,
        transferNumber: transferNumberFromTwilio,
        transferStatus: transferStatusFromTwilio,
        parentCallSid: twilioParentSid,
        transferredAt: transferredAtFromTwilio,
        childCallSid: transferChild?.sid,
        dryRun
      });

    } catch (error) {
      results.push({
        callId: call.callId,
        status: 'error',
        error: String(error)
      });
    }
  }

  const summary = {
    total: callsToSync.length,
    updated: results.filter(r => r.status === 'updated').length,
    noChild: results.filter(r => r.status === 'no_child').length,
    notCompleted: results.filter(r => r.status === 'not_completed').length,
    noTwilioSid: results.filter(r => r.status === 'no_twilio_sid').length,
    errors: results.filter(r => r.status === 'error').length
  };

  console.log('sync-transfer-metrics: Complete', summary);

  return res.json({
    ok: true,
    dryRun,
    lookbackMinutes,
    summary,
    results
  });
});

export default router;
