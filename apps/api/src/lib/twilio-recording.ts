/**
 * Twilio Recording helpers
 * Enables recording on child calls (post-transfer) and fetches transcriptions
 */

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? '';
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL ?? 'https://revenioapi-production.up.railway.app';

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

  // Retry logic: try up to 5 times with increasing delays
  const maxRetries = 5;
  const delays = [1000, 2000, 3000, 4000, 5000]; // 1s, 2s, 3s, 4s, 5s

  for (let attempt = 0; attempt < maxRetries; attempt++) {
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
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delays[attempt]));
          continue;
        }
        return { childCallSid: null, recordingSid: null, error: `list_failed:${listResp.status}` };
      }

      const data = await listResp.json() as Record<string, unknown>;
      const calls = Array.isArray(data.calls) ? data.calls as Array<Record<string, unknown>> : [];

      // Filter to find calls that can be recorded (in-progress, ringing, or queued)
      const recordableCalls = calls.filter(c => {
        const status = typeof c.status === 'string' ? c.status : '';
        return status === 'in-progress' || status === 'ringing' || status === 'queued';
      });

      if (recordableCalls.length === 0) {
        console.log(`No recordable child calls found for ${parentCallSid} (attempt ${attempt + 1}/${maxRetries}, found ${calls.length} total calls)`);
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delays[attempt]));
          continue;
        }
        
        // On last attempt, log all child call statuses for debugging
        const statuses = calls.map(c => ({ sid: c.sid, status: c.status }));
        console.log('Child call statuses:', JSON.stringify(statuses));
        return { childCallSid: null, recordingSid: null, error: 'no_recordable_child_calls' };
      }

      // Start recording on the first recordable child call
      const childCall = recordableCalls[0];
      const childCallSid = typeof childCall.sid === 'string' ? childCall.sid : null;
      const childStatus = typeof childCall.status === 'string' ? childCall.status : 'unknown';

      if (!childCallSid) {
        return { childCallSid: null, recordingSid: null, error: 'invalid_child_call' };
      }

      console.log(`Found child call ${childCallSid} with status ${childStatus}, starting recording...`);
      const { recordingSid, error } = await startRecordingOnCall(childCallSid);
      
      if (recordingSid) {
        return { childCallSid, recordingSid, error: null };
      }
      
      // If recording failed but call exists, maybe it's not ready yet - retry
      if (error && error.includes('call_not_found') && attempt < maxRetries - 1) {
        console.log(`Recording failed for ${childCallSid}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, delays[attempt]));
        continue;
      }
      
      return { childCallSid, recordingSid, error };
    } catch (error) {
      console.error('Error in startRecordingOnChildCalls:', { parentCallSid, attempt, error: String(error) });
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delays[attempt]));
        continue;
      }
      return { childCallSid: null, recordingSid: null, error: String(error) };
    }
  }

  return { childCallSid: null, recordingSid: null, error: 'max_retries_exceeded' };
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
