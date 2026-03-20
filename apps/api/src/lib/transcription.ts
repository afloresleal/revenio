import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const OPENAI_AUDIO_MODEL = process.env.OPENAI_AUDIO_MODEL ?? 'whisper-1';
const OPENAI_TRANSCRIBE_TIMEOUT_MS = Number(process.env.OPENAI_TRANSCRIBE_TIMEOUT_MS ?? 45000);
const RECORDING_DOWNLOAD_TIMEOUT_MS = Number(process.env.RECORDING_DOWNLOAD_TIMEOUT_MS ?? 30000);

const TRANSCRIPTION_PROVIDER = (process.env.TRANSCRIPTION_PROVIDER ?? 'auto').toLowerCase(); // auto|openai|local
const WHISPER_LOCAL_ENABLED = String(process.env.WHISPER_LOCAL_ENABLED ?? '').toLowerCase() === 'true';
const WHISPER_LOCAL_BIN = process.env.WHISPER_LOCAL_BIN ?? 'whisper';
const WHISPER_LOCAL_MODEL = process.env.WHISPER_LOCAL_MODEL ?? 'base';
const WHISPER_LOCAL_LANGUAGE = process.env.WHISPER_LOCAL_LANGUAGE ?? '';
const WHISPER_LOCAL_TIMEOUT_MS = Number(process.env.WHISPER_LOCAL_TIMEOUT_MS ?? 180000);

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? '';

export type TranscriptSource = 'openai_audio_transcription' | 'local_whisper_transcription' | 'fallback_compose';

export function composeFullTranscript(aiTranscript: string | null | undefined, transferTranscript: string | null | undefined): string | null {
  const ai = typeof aiTranscript === 'string' && aiTranscript.trim() ? aiTranscript.trim() : null;
  const transfer = typeof transferTranscript === 'string' && transferTranscript.trim() ? transferTranscript.trim() : null;
  if (!ai && !transfer) return null;
  if (ai && !transfer) return ai;
  if (!ai && transfer) return `Transfer (humano): ${transfer}`;
  return `${ai}\n\nTransfer (humano): ${transfer}`;
}

function canUseOpenAI(): boolean {
  return Boolean(OPENAI_API_KEY);
}

function canUseLocalWhisper(): boolean {
  return WHISPER_LOCAL_ENABLED || TRANSCRIPTION_PROVIDER === 'local';
}

export function canTranscribeRecording(): boolean {
  if (TRANSCRIPTION_PROVIDER === 'openai') return canUseOpenAI();
  if (TRANSCRIPTION_PROVIDER === 'local') return canUseLocalWhisper();
  return canUseOpenAI() || canUseLocalWhisper();
}

function extensionFromContentType(contentType: string | null): string {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'mp3';
  if (ct.includes('ogg')) return 'ogg';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('mp4') || ct.includes('m4a')) return 'm4a';
  if (ct.includes('wav')) return 'wav';
  return 'wav';
}

function getTwilioAuth(): string {
  return Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
}

function isTwilioUrl(url: string): boolean {
  return url.includes('api.twilio.com') || url.includes('twilio.com');
}

async function downloadRecording(recordingUrl: string): Promise<{ buffer: ArrayBuffer; contentType: string; ext: string } | null> {
  if (!recordingUrl || typeof recordingUrl !== 'string') return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RECORDING_DOWNLOAD_TIMEOUT_MS);
  
  // Add Twilio auth headers if this is a Twilio URL
  const headers: Record<string, string> = {};
  if (isTwilioUrl(recordingUrl) && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    headers['Authorization'] = `Basic ${getTwilioAuth()}`;
  }
  
  try {
    const audioResp = await fetch(recordingUrl, { signal: controller.signal, headers });
    if (!audioResp.ok) {
      throw new Error(`recording_download_failed:${audioResp.status}`);
    }
    const contentType = audioResp.headers.get('content-type') || 'audio/wav';
    const buffer = await audioResp.arrayBuffer();
    if (!buffer.byteLength) return { buffer, contentType, ext: extensionFromContentType(contentType) };
    return { buffer, contentType, ext: extensionFromContentType(contentType) };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`recording_download_timeout:${RECORDING_DOWNLOAD_TIMEOUT_MS}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function transcribeWithOpenAI(input: { buffer: ArrayBuffer; contentType: string }): Promise<string | null> {
  if (!canUseOpenAI()) return null;

  const form = new FormData();
  form.append('model', OPENAI_AUDIO_MODEL);
  form.append('response_format', 'text');
  form.append('file', new Blob([input.buffer], { type: input.contentType }), 'call-audio.wav');

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

async function transcribeWithLocalWhisper(input: { buffer: ArrayBuffer; ext: string }): Promise<string | null> {
  if (!canUseLocalWhisper()) return null;
  const tmpBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'revenio-whisper-'));
  const inputPath = path.join(tmpBaseDir, `audio.${input.ext}`);
  const outputDir = path.join(tmpBaseDir, 'out');
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(inputPath, Buffer.from(input.buffer));

  const args = [
    inputPath,
    '--model',
    WHISPER_LOCAL_MODEL,
    '--task',
    'transcribe',
    '--output_format',
    'txt',
    '--output_dir',
    outputDir,
  ];
  if (WHISPER_LOCAL_LANGUAGE) {
    args.push('--language', WHISPER_LOCAL_LANGUAGE);
  }

  try {
    await execFileAsync(WHISPER_LOCAL_BIN, args, { timeout: WHISPER_LOCAL_TIMEOUT_MS, maxBuffer: 1024 * 1024 * 4 });
    const txtPath = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.txt`);
    const text = await fs.readFile(txtPath, 'utf8').catch(() => '');
    const cleaned = text.trim();
    return cleaned || null;
  } catch (error) {
    throw new Error(`local_whisper_failed:${String(error)}`);
  } finally {
    await fs.rm(tmpBaseDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function transcribeRecordingFromUrl(recordingUrl: string): Promise<{ text: string | null; source: TranscriptSource | null }> {
  if (!recordingUrl || typeof recordingUrl !== 'string') return { text: null, source: null };
  if (!canTranscribeRecording()) return { text: null, source: null };

  const downloaded = await downloadRecording(recordingUrl);
  if (!downloaded || !downloaded.buffer.byteLength) return { text: null, source: null };

  if (TRANSCRIPTION_PROVIDER === 'openai') {
    const text = await transcribeWithOpenAI(downloaded);
    return { text, source: text ? 'openai_audio_transcription' : null };
  }
  if (TRANSCRIPTION_PROVIDER === 'local') {
    const text = await transcribeWithLocalWhisper(downloaded);
    return { text, source: text ? 'local_whisper_transcription' : null };
  }

  // auto: prefer OpenAI when key exists, fallback to local Whisper.
  if (canUseOpenAI()) {
    try {
      const text = await transcribeWithOpenAI(downloaded);
      if (text) return { text, source: 'openai_audio_transcription' };
    } catch {
      // fallback to local whisper below
    }
  }
  const localText = await transcribeWithLocalWhisper(downloaded);
  return { text: localText, source: localText ? 'local_whisper_transcription' : null };
}
