import assert from 'node:assert/strict';
import { formatRoundRobinAttemptStatus, formatTransferResult } from './round-robin-status';

assert.equal(
  formatTransferResult('child-never-answered-no-callback'),
  'No confirmado a tiempo',
);

assert.equal(
  formatRoundRobinAttemptStatus('child-never-answered-no-callback'),
  'No confirmado a tiempo',
);

assert.equal(
  formatRoundRobinAttemptStatus('human-answered'),
  'Contestó',
);

assert.equal(
  formatRoundRobinAttemptStatus('no-answer'),
  'No contestó',
);

console.log('round-robin-status tests passed');
