import assert from 'node:assert/strict';
import {
  buildRoundRobinAttempts,
  formatRoundRobinAttemptStatus,
  formatTransferResult,
} from './round-robin-status';

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

const inferredAttempts = buildRoundRobinAttempts({
  firstAgentName: 'Ileana M Cazares',
  firstAgentNumber: null,
  firstAgentResult: null,
  answeredAgentName: 'Ileana M Cazares',
  answeredAgentNumber: null,
  answeredAgentIndex: 1,
  failoverSteps: [],
});

assert.deepEqual(inferredAttempts, [
  {
    identity: 'Ileana M Cazares',
    result: 'child-never-answered-no-callback',
    answered: false,
  },
  {
    identity: 'Ileana M Cazares',
    result: 'human-answered',
    answered: true,
  },
]);

console.log('round-robin-status tests passed');
