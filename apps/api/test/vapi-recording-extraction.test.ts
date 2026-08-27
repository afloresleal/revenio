/**
 * Tests for Vapi recording URL extraction
 * Ensures recording URLs are correctly extracted from various Vapi webhook payload structures
 */

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { extractVapiRecordingUrl } from '../src/lib/vapi-recording-extraction.js';

describe('extractVapiRecordingUrl', () => {
  test('extracts from data.recordingUrl (legacy format)', () => {
    const data = {
      id: 'call-123',
      recordingUrl: 'https://example.com/recording.mp3',
    };

    const result = extractVapiRecordingUrl(data, { enableLogging: false });
    assert.strictEqual(result, 'https://example.com/recording.mp3');
  });

  test('extracts from artifact.recordingUrl', () => {
    const data = {
      id: 'call-123',
      artifact: {
        recordingUrl: 'https://example.com/artifact-recording.mp3',
      },
    };

    const result = extractVapiRecordingUrl(data, { enableLogging: false });
    assert.strictEqual(result, 'https://example.com/artifact-recording.mp3');
  });

  test('extracts from artifact.recording.url (2026 format)', () => {
    const data = {
      id: 'call-123',
      artifact: {
        recording: {
          url: 'https://example.com/new-recording.mp3',
        },
      },
    };

    const result = extractVapiRecordingUrl(data, { enableLogging: false });
    assert.strictEqual(result, 'https://example.com/new-recording.mp3');
  });

  test('extracts from artifact.recording.mono.combinedUrl', () => {
    const data = {
      id: 'call-123',
      artifact: {
        recording: {
          mono: {
            combinedUrl: 'https://example.com/mono-combined.mp3',
          },
        },
      },
    };

    const result = extractVapiRecordingUrl(data, { enableLogging: false });
    assert.strictEqual(result, 'https://example.com/mono-combined.mp3');
  });

  test('extracts from artifact.recording.mono.url', () => {
    const data = {
      id: 'call-123',
      artifact: {
        recording: {
          mono: {
            url: 'https://example.com/mono.mp3',
          },
        },
      },
    };

    const result = extractVapiRecordingUrl(data, { enableLogging: false });
    assert.strictEqual(result, 'https://example.com/mono.mp3');
  });

  test('extracts from data.stereoRecordingUrl as fallback', () => {
    const data = {
      id: 'call-123',
      stereoRecordingUrl: 'https://example.com/stereo.mp3',
    };

    const result = extractVapiRecordingUrl(data, { enableLogging: false });
    assert.strictEqual(result, 'https://example.com/stereo.mp3');
  });

  test('extracts from artifact.stereoRecordingUrl as fallback', () => {
    const data = {
      id: 'call-123',
      artifact: {
        stereoRecordingUrl: 'https://example.com/artifact-stereo.mp3',
      },
    };

    const result = extractVapiRecordingUrl(data, { enableLogging: false });
    assert.strictEqual(result, 'https://example.com/artifact-stereo.mp3');
  });

  test('returns null when no recording URL is present', () => {
    const data = {
      id: 'call-123',
      artifact: {
        transcript: 'hello world',
      },
    };

    const result = extractVapiRecordingUrl(data, { enableLogging: false });
    assert.strictEqual(result, null);
  });

  test('returns null when artifact is missing', () => {
    const data = {
      id: 'call-123',
    };

    const result = extractVapiRecordingUrl(data, { enableLogging: false });
    assert.strictEqual(result, null);
  });

  test('prioritizes data.recordingUrl over nested values', () => {
    const data = {
      id: 'call-123',
      recordingUrl: 'https://example.com/priority.mp3',
      artifact: {
        recordingUrl: 'https://example.com/should-not-use.mp3',
        recording: {
          url: 'https://example.com/should-not-use-2.mp3',
        },
      },
    };

    const result = extractVapiRecordingUrl(data, { enableLogging: false });
    assert.strictEqual(result, 'https://example.com/priority.mp3');
  });

  test('handles empty strings as null', () => {
    const data = {
      id: 'call-123',
      recordingUrl: '  ',
      artifact: {
        recordingUrl: '',
        recording: {
          url: 'https://example.com/valid.mp3',
        },
      },
    };

    const result = extractVapiRecordingUrl(data, { enableLogging: false });
    assert.strictEqual(result, 'https://example.com/valid.mp3');
  });

  test('handles null values gracefully', () => {
    const data = {
      id: 'call-123',
      recordingUrl: null,
      artifact: {
        recordingUrl: null,
        recording: null,
      },
    };

    const result = extractVapiRecordingUrl(data, { enableLogging: false });
    assert.strictEqual(result, null);
  });

  test('handles complex nested structure with all paths', () => {
    const data = {
      id: 'call-123',
      artifact: {
        recording: {
          mono: {
            url: 'https://example.com/mono-url.mp3',
            combinedUrl: 'https://example.com/mono-combined.mp3',
          },
          stereo: {
            url: 'https://example.com/stereo-url.mp3',
          },
          url: 'https://example.com/recording-url.mp3',
        },
        recordingUrl: 'https://example.com/artifact-recording-url.mp3',
        stereoRecordingUrl: 'https://example.com/artifact-stereo.mp3',
      },
      recordingUrl: 'https://example.com/data-recording-url.mp3',
      stereoRecordingUrl: 'https://example.com/data-stereo.mp3',
    };

    const result = extractVapiRecordingUrl(data, { enableLogging: false });
    // Should pick the first available in priority order
    assert.strictEqual(result, 'https://example.com/data-recording-url.mp3');
  });
});
