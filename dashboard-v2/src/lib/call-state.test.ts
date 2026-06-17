import assert from 'node:assert/strict';
import { formatEndedReason, hasActualTransfer } from './call-state';

assert.equal(
  hasActualTransfer({
    transferredAt: null,
    twilioTransferCallSid: null,
    transferStatus: null,
    postTransferDurationSec: 0,
  }),
  false,
  'planned transfer without handoff evidence should not count as actual transfer',
);

assert.equal(
  hasActualTransfer({
    transferredAt: '2026-06-17T01:41:20.000Z',
    twilioTransferCallSid: null,
    transferStatus: null,
    postTransferDurationSec: 0,
  }),
  true,
  'transferredAt should count as actual transfer evidence',
);

assert.equal(formatEndedReason('customer-did-not-answer'), 'Cliente no contestó');
assert.equal(formatEndedReason('voicemail'), 'Buzón detectado');

console.log('call-state tests passed');
