const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const OPENAI_AUDIO_MODEL = process.env.OPENAI_AUDIO_MODEL ?? 'whisper-1';
const OPENAI_TRANSCRIBE_TIMEOUT_MS = Number(process.env.OPENAI_TRANSCRIBE_TIMEOUT_MS ?? 45000);

export function composeFullTranscript(aiTranscript: string | null | undefined, transferTranscript: string | null | undefined): string | null {
  const ai = typeof aiTranscript === 'string' && aiTranscript.trim() ? aiTranscript.trim() : null;
  const transfer = typeof transferTranscript === 'string' && transferTranscript.trim() ? transferTranscript.trim() : null;
  if (!ai && !transfer) return null;
  if (ai && !transfer) return ai;
  if (!ai && transfer) return `Transfer (humano): ${transfer}`;
  return `${ai}\n\nTransfer (humano): ${transfer}`;
}

export function canTranscribeWithOpenAI(): boolean {
  return Boolean(OPENAI_API_KEY);
}

export async function transcribeRecordingFromUrl(recordingUrl: string): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;
  if (!recordingUrl || typeof recordingUrl !== 'string') return null;

  const audioResp = await fetch(recordingUrl);
  if (!audioResp.ok) {
    throw new Error(`recording_download_failed:${audioResp.status}`);
  }
  const contentType = audioResp.headers.get('content-type') || 'audio/wav';
  const buffer = await audioResp.arrayBuffer();
  if (!buffer.byteLength) return null;

  const form = new FormData();
  form.append('model', OPENAI_AUDIO_MODEL);
  form.append('response_format', 'text');
  form.append('file', new Blob([buffer], { type: contentType }), 'call-audio.wav');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TRANSCRIBE_TIMEOUT_MS);

  try {
    const transcriptionResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
      signal: controller.signal,
    });
    const payloadText = await transcriptionResp.text();
    if (!transcriptionResp.ok) {
      throw new Error(`openai_transcription_failed:${transcriptionResp.status}:${payloadText.slice(0, 300)}`);
    }
    const transcript = payloadText.trim();
    return transcript || null;
  } finally {
    clearTimeout(timeout);
  }
}
