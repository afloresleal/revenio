import assert from 'node:assert/strict';
import { consolidateContactAttempts } from '../src/lib/contact-attempts.ts';

const consolidated = consolidateContactAttempts([
  {
    attemptId: 'attempt-1',
    callId: 'call-1',
    ghlRootAttemptId: 'attempt-1',
    phone: '+525500000001',
    leadName: 'Ale',
    campaignName: 'test-1',
    outcome: 'voicemail',
    duration: 41,
    ago: 'hace 1 min',
    ghlRetryTriggered: true,
    ghlIsRetryAttempt: false,
  },
  {
    attemptId: 'attempt-2',
    callId: 'call-2',
    ghlRootAttemptId: 'attempt-1',
    phone: '+525500000001',
    leadName: 'Ale',
    campaignName: 'test-1',
    outcome: 'completed',
    duration: 120,
    ago: 'hace 1 min',
    ghlIsRetryAttempt: true,
  },
]);

assert.equal(consolidated.length, 1, 'should collapse both attempts into one visible row');
assert.equal(consolidated[0]?.callId, 'call-2', 'consolidated row should use the second attempt as the visible base');
assert.equal(consolidated[0]?.outcome, 'completed', 'consolidated row should expose the final attempt outcome');
assert.equal(consolidated[0]?.duration, 120, 'consolidated row should expose the final attempt duration');
assert.equal(consolidated[0]?.ghlFlowLabel, 'Segunda llamada completada', 'consolidated row should summarize the full flow');
assert.deepEqual(
  consolidated[0]?.ghlAttemptTimeline,
  [
    { label: 'Intento 1', outcome: 'voicemail', callId: 'call-1' },
    { label: 'Intento 2', outcome: 'completed', callId: 'call-2' },
  ],
  'consolidated row should preserve both attempts in the timeline',
);

console.log('contact-attempt consolidation tests passed');
