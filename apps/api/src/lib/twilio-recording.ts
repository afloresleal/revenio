/**
 * Twilio Recording helpers
 * Enables recording on child calls (post-transfer) and fetches transcriptions
 */

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? '';
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL ?? 'https://revenioapi-production.up.railway.app';
const CHILD_CALL_POLL_INTERVAL_MS = getEnvMs('TRANSFER_CHILD_CALL_POLL_INTERVAL_MS', 1200, 500);
const FAILOVER_RING_TIMEOUT_MS = getEnvMs('TRANSFER_FAILOVER_RING_TIMEOUT_SEC', 15, 1) * 1000;
const DEFAULT_CHILD_CALL_MAX_WAIT_MS = Math.max(FAILOVER_RING_TIMEOUT_MS + 2000, 9000);
const CHILD_CALL_MAX_WAIT_MS = getEnvMs('TRANSFER_CHILD_CALL_MAX_WAIT_MS', DEFAULT_CHILD_CALL_MAX_WAIT_MS, 1000);

function getEnvMs(name: string, fallback: number, min: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

function getTwilioAuth(): string {
  return Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
}

export function canUseTwilio(): boolean {
  return Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN);
}

/**
 * Start recording on an active Twilio call
 * Returns the recording SID if successful
 */
export async function startRecordingOnCall(callSid: string): Promise<{ recordingSid: string | null; error: string | null }> {
  if (!canUseTwilio() || !callSid) {
    return { recordingSid: null, error: 'missing_credentials_or_callsid' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${callSid}/Recordings.json`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${getTwilioAuth()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'RecordingStatusCallback': `${WEBHOOK_BASE_URL}/webhooks/twilio/recording-status`,
        'RecordingStatusCallbackEvent': 'completed',
        'RecordingChannels': 'dual',
      }).toString(),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      // Call may have already ended or recording already exists
      if (resp.status === 400 && body.includes('already has a recording')) {
        console.log('Recording already exists for call:', callSid);
        return { recordingSid: null, error: 'recording_already_exists' };
      }
      if (resp.status === 404) {
        console.log('Call not found or already ended:', callSid);
        return { recordingSid: null, error: 'call_not_found' };
      }
      console.warn('Failed to start recording:', { status: resp.status, body, callSid });
      return { recordingSid: null, error: `twilio_error:${resp.status}` };
    }

    const data = await resp.json() as Record<string, unknown>;
    const recordingSid = typeof data.sid === 'string' ? data.sid : null;
    console.log('Recording started:', { callSid, recordingSid });
    return { recordingSid, error: null };
  } catch (error) {
    console.error('Error starting recording:', { callSid, error: String(error) });
    return { recordingSid: null, error: String(error) };
  }
}

/**
 * Find child calls for a parent call and start recording on them
 * Retries multiple times since child call may take time to appear
 */
export async function startRecordingOnChildCalls(parentCallSid: string): Promise<{
  childCallSid: string | null;
  recordingSid: string | null;
  error: string | null;
}> {
  if (!canUseTwilio() || !parentCallSid) {
    return { childCallSid: null, recordingSid: null, error: 'missing_credentials_or_callsid' };
  }

  const maxAttempts = Math.max(1, Math.ceil(CHILD_CALL_MAX_WAIT_MS / CHILD_CALL_POLL_INTERVAL_MS));
  let sawPendingChildCall = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Find child calls - don't filter by status, get all recent child calls
      const listUrl = new URL(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`);
      listUrl.searchParams.set('ParentCallSid', parentCallSid);
      listUrl.searchParams.set('PageSize', '10');

      const listResp = await fetch(listUrl.toString(), {
        headers: { 'Authorization': `Basic ${getTwilioAuth()}` },
      });

      if (!listResp.ok) {
        const body = await listResp.text().catch(() => '');
        console.warn('Failed to list child calls:', { status: listResp.status, body, attempt });
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, CHILD_CALL_POLL_INTERVAL_MS));
          continue;
        }
        return { childCallSid: null, recordingSid: null, error: `list_failed:${listResp.status}` };
      }

      const data = await listResp.json() as Record<string, unknown>;
      const calls = Array.isArray(data.calls) ? data.calls as Array<Record<string, unknown>> : [];

      // Log all child call statuses for debugging
      const statuses = calls.map(c => ({ sid: c.sid, status: c.status }));
      console.log(`Child calls for ${parentCallSid} (attempt ${attempt + 1}/${maxAttempts}):`, JSON.stringify(statuses));

      // Only in-progress calls can be recorded (not queued, not ringing)
      const inProgressCalls = calls.filter(c => c.status === 'in-progress');
      
      if (inProgressCalls.length === 0) {
        // Check if there are calls that might become in-progress soon
        const pendingCalls = calls.filter(c => c.status === 'queued' || c.status === 'ringing');
        if (pendingCalls.length > 0) {
          sawPendingChildCall = true;
          if (attempt < maxAttempts - 1) {
            console.log(`Found ${pendingCalls.length} pending child call(s), waiting for in-progress...`);
            await new Promise(resolve => setTimeout(resolve, CHILD_CALL_POLL_INTERVAL_MS));
            continue;
          }
          // Child leg never became in-progress within retry window; avoid treating this as no-answer.
          return { childCallSid: null, recordingSid: null, error: 'child_calls_still_pending' };
        }
        
        if (calls.length === 0) {
          console.log(`No child calls found for ${parentCallSid}`);
        } else {
          console.log(`No in-progress child calls (found ${calls.length} with other statuses)`);
        }
        
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, CHILD_CALL_POLL_INTERVAL_MS));
          continue;
        }
        return {
          childCallSid: null,
          recordingSid: null,
          error: sawPendingChildCall ? 'child_calls_still_pending' : 'no_in_progress_child_calls',
        };
      }

      // Start recording on the first in-progress child call
      const childCall = inProgressCalls[0];
      const childCallSid = typeof childCall.sid === 'string' ? childCall.sid : null;

      if (!childCallSid) {
        return { childCallSid: null, recordingSid: null, error: 'invalid_child_call' };
      }

      console.log(`Found in-progress child call ${childCallSid}, starting recording...`);
      const { recordingSid, error } = await startRecordingOnCall(childCallSid);
      
      if (recordingSid) {
        return { childCallSid, recordingSid, error: null };
      }
      
      // If recording failed, retry
      if (attempt < maxAttempts - 1) {
        console.log(`Recording failed for ${childCallSid} (${error}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, CHILD_CALL_POLL_INTERVAL_MS));
        continue;
      }
      
      return { childCallSid, recordingSid, error };
    } catch (error) {
      console.error('Error in startRecordingOnChildCalls:', { parentCallSid, attempt, error: String(error) });
      if (attempt < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, CHILD_CALL_POLL_INTERVAL_MS));
        continue;
      }
      return { childCallSid: null, recordingSid: null, error: String(error) };
    }
  }

  return {
    childCallSid: null,
    recordingSid: null,
    error: sawPendingChildCall ? 'child_calls_still_pending' : 'max_retries_exceeded',
  };
}

/**
 * Get recording URL for a call
 */
export async function getRecordingForCall(callSid: string): Promise<{
  recordingUrl: string | null;
  recordingSid: string | null;
  duration: number | null;
}> {
  if (!canUseTwilio() || !callSid) {
    return { recordingUrl: null, recordingSid: null, duration: null };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${callSid}/Recordings.json`;
    const resp = await fetch(url, {
      headers: { 'Authorization': `Basic ${getTwilioAuth()}` },
    });

    if (!resp.ok) {
      return { recordingUrl: null, recordingSid: null, duration: null };
    }

    const data = await resp.json() as Record<string, unknown>;
    const recordings = Array.isArray(data.recordings) ? data.recordings as Array<Record<string, unknown>> : [];

    if (recordings.length === 0) {
      return { recordingUrl: null, recordingSid: null, duration: null };
    }

    const recording = recordings[0];
    const recordingSid = typeof recording.sid === 'string' ? recording.sid : null;
    const durationStr = typeof recording.duration === 'string' ? recording.duration : null;
    const duration = durationStr ? parseInt(durationStr, 10) : null;

    // Construct recording URL
    const recordingUrl = recordingSid
      ? `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.mp3`
      : null;

    return { recordingUrl, recordingSid, duration: Number.isFinite(duration) ? duration : null };
  } catch (error) {
    console.error('Error getting recording:', { callSid, error: String(error) });
    return { recordingUrl: null, recordingSid: null, duration: null };
  }
}

/**
 * Request transcription for a recording
 */
export async function requestTranscription(recordingSid: string): Promise<{ transcriptionSid: string | null; error: string | null }> {
  if (!canUseTwilio() || !recordingSid) {
    return { transcriptionSid: null, error: 'missing_credentials_or_recordingsid' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}/Transcriptions.json`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${getTwilioAuth()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'TranscriptionCallbackUrl': `${WEBHOOK_BASE_URL}/webhooks/twilio/transcription-complete`,
      }).toString(),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.warn('Failed to request transcription:', { status: resp.status, body, recordingSid });
      return { transcriptionSid: null, error: `twilio_error:${resp.status}` };
    }

    const data = await resp.json() as Record<string, unknown>;
    const transcriptionSid = typeof data.sid === 'string' ? data.sid : null;
    console.log('Transcription requested:', { recordingSid, transcriptionSid });
    return { transcriptionSid, error: null };
  } catch (error) {
    console.error('Error requesting transcription:', { recordingSid, error: String(error) });
    return { transcriptionSid: null, error: String(error) };
  }
}
