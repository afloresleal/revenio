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

interface TwilioCall {
  sid: string;
  to: string;
  from: string;
  status: string;
  duration: string;
  startTime: string;
  endTime: string;
  parentCallSid: string | null;
}

interface TwilioCallsResponse {
  calls: TwilioCall[];
}

interface TwilioCallDetail {
  sid?: string;
  duration?: string;
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
 * - ended in last 24 hours
 * 
 * For each, fetches Twilio child call duration and updates the metric.
 */
router.post('/sync-transfer-metrics', async (req, res) => {
  const dryRun = req.query.dry_run === 'true';
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  
  // Find calls needing sync
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24h
  
  const callsToSync = await prisma.callMetric.findMany({
    where: {
      outcome: 'transfer_success',
      OR: [
        { postTransferDurationSec: null },
        { postTransferDurationSec: 0 }
      ],
      endedAt: { gte: cutoff }
    },
    orderBy: { endedAt: 'desc' },
    take: limit
  });

  console.log('sync-transfer-metrics: Found calls to sync', { count: callsToSync.length, dryRun });

  const results: Array<{
    callId: string;
    status: 'updated' | 'no_child' | 'not_completed' | 'no_twilio_sid' | 'error';
    postTransferDurationSec?: number;
    totalDurationSec?: number;
    childCallSid?: string;
    error?: string;
  }> = [];

  for (const call of callsToSync) {
    try {
      // Get Twilio parent CallSid from VAPI
      const twilioParentSid = await getVapiCallTwilioSid(call.callId);
      
      if (!twilioParentSid) {
        results.push({ callId: call.callId, status: 'no_twilio_sid' });
        continue;
      }

      const twilioTotalDurationSec = await fetchTwilioCallDuration(twilioParentSid);

      // Fetch child calls
      const childCalls = await fetchTwilioChildCalls(twilioParentSid);

      // Find the transfer child call (prefer completed, match transfer number if available)
      const completedChild = childCalls.find(c => c.status === 'completed' && parseInt(c.duration, 10) > 0);
      const postTransferDurationSec = completedChild ? parseInt(completedChild.duration, 10) : null;

      if (!dryRun) {
        const nextDurationSec =
          twilioTotalDurationSec !== null && twilioTotalDurationSec > (call.durationSec ?? 0)
            ? twilioTotalDurationSec
            : call.durationSec;
        await prisma.callMetric.update({
          where: { callId: call.callId },
          data: {
            postTransferDurationSec: postTransferDurationSec ?? undefined,
            durationSec: nextDurationSec ?? undefined
          }
        });
      }

      let status: 'updated' | 'no_child' | 'not_completed' = 'updated';
      const hasAnyDuration = postTransferDurationSec !== null || twilioTotalDurationSec !== null;
      if (!hasAnyDuration) {
        if (childCalls.length === 0) status = 'no_child';
        else if (!completedChild) status = 'not_completed';
      }

      results.push({
        callId: call.callId,
        status,
        postTransferDurationSec: postTransferDurationSec ?? undefined,
        totalDurationSec: twilioTotalDurationSec ?? undefined,
        childCallSid: completedChild?.sid
      });

      console.log('sync-transfer-metrics: Updated call', {
        callId: call.callId,
        postTransferDurationSec: postTransferDurationSec,
        totalDurationSec: twilioTotalDurationSec,
        childCallSid: completedChild?.sid,
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
    summary,
    results
  });
});

export default router;
