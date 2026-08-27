/**
 * Vapi Recording URL Extraction
 *
 * Unified logic for extracting recording URLs from Vapi webhooks and API responses.
 * As of 2026, Vapi uses access-controlled storage - URLs may require authentication.
 */

/**
 * Helper: Safely cast value to string or return null
 */
function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Helper: Safely cast value to Record or return null
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Extract recording URL from Vapi call data
 *
 * Tries multiple paths for compatibility with different Vapi webhook versions.
 * Priority order (first found wins):
 * 1. data.recordingUrl (legacy format)
 * 2. artifact.recordingUrl
 * 3. artifact.recording.url (2026 format)
 * 4. artifact.recording.mono.combinedUrl
 * 5. artifact.recording.mono.url
 * 6. data.stereoRecordingUrl (fallback)
 * 7. artifact.stereoRecordingUrl (fallback)
 *
 * Note: As of 2026, Vapi uses access-controlled storage. These URLs may not be
 * directly downloadable without authentication via the Vapi API.
 *
 * @param data - Vapi webhook payload or API response
 * @param options - Optional configuration
 * @param options.enableLogging - Log extraction results (default: true)
 * @returns Recording URL or null if not found
 */
export function extractVapiRecordingUrl(
  data: Record<string, unknown>,
  options?: { enableLogging?: boolean }
): string | null {
  const enableLogging = options?.enableLogging ?? true;

  const artifact = asRecord(data.artifact);
  const recording = asRecord(artifact?.recording);
  const mono = asRecord(recording?.mono);

  const url = (
    asString(data.recordingUrl) ??
    asString(artifact?.recordingUrl) ??
    asString(recording?.url) ??
    asString(mono?.combinedUrl) ??
    asString(mono?.url) ??
    asString(data.stereoRecordingUrl) ??
    asString(artifact?.stereoRecordingUrl) ??
    null
  );

  // Log when recording URL is found or missing for debugging
  if (enableLogging) {
    const callId = asString(data.id);
    if (!url && callId) {
      console.log('⚠️ No recording URL found in Vapi data:', {
        callId,
        hasArtifact: !!artifact,
        hasRecording: !!recording,
        hasMono: !!mono,
        artifactKeys: artifact ? Object.keys(artifact) : [],
        recordingKeys: recording ? Object.keys(recording) : [],
      });
    } else if (url && callId) {
      console.log('✅ Recording URL extracted from Vapi:', {
        callId,
        urlLength: url.length,
        urlPrefix: url.substring(0, 50),
      });
    }
  }

  return url;
}

/**
 * Extract stereo recording URL from Vapi call data
 *
 * Similar to extractVapiRecordingUrl but prioritizes stereo recordings.
 *
 * @param data - Vapi webhook payload or API response
 * @param options - Optional configuration
 * @returns Stereo recording URL or null if not found
 */
export function extractVapiStereoRecordingUrl(
  data: Record<string, unknown>,
  options?: { enableLogging?: boolean }
): string | null {
  const enableLogging = options?.enableLogging ?? false; // Less noisy for stereo

  const artifact = asRecord(data.artifact);
  const recording = asRecord(artifact?.recording);
  const stereo = asRecord(recording?.stereo);

  const url = (
    asString(data.stereoRecordingUrl) ??
    asString(artifact?.stereoRecordingUrl) ??
    asString(stereo?.url) ??
    asString(recording?.url) ?? // Fallback to generic recording URL
    null
  );

  if (enableLogging) {
    const callId = asString(data.id);
    if (url && callId) {
      console.log('✅ Stereo recording URL extracted from Vapi:', {
        callId,
        urlLength: url.length,
      });
    }
  }

  return url;
}
