import assert from "node:assert/strict";

import { hasHumanTransferEvidence, resolveRoundRobinAnsweredAgent } from "../src/lib/round-robin-resolution.js";

const explicit = resolveRoundRobinAnsweredAgent({
  resultJson: {
    roundRobin: {
      enabled: true,
      answeredAgentName: "Ileana",
      answeredAgentNumber: "+529841679017",
      answeredAgentIndex: 1,
      agents: [
        { name: "Eliana", transferNumber: "+529841111111" },
        { name: "Ileana", transferNumber: "+529841679017" },
      ],
    },
  },
  transferNumber: "+529841111111",
  hasHumanConnectionEvidence: hasHumanTransferEvidence({
    transferStatus: "ringing",
    postTransferDurationSec: 174,
    transferTranscript: "Hola",
    transferRecordingUrl: "https://example.com/rec.mp3",
  }),
});

assert.deepEqual(
  explicit,
  {
    name: "Ileana",
    number: "+529841679017",
    index: 1,
    inferred: false,
  },
  "explicit answered agent metadata should win",
);

const inferred = resolveRoundRobinAnsweredAgent({
  resultJson: {
    roundRobin: {
      enabled: true,
      selectedAgentIndex: 0,
      agents: [
        { name: "Eliana", transferNumber: "+529841111111" },
        { name: "Matias", transferNumber: "+529841679017" },
      ],
    },
  },
  transferNumber: "+529841679017",
  hasHumanConnectionEvidence: hasHumanTransferEvidence({
    transferStatus: "ringing",
    postTransferDurationSec: 174,
    transferTranscript: "Hola, ya quedó",
    transferRecordingUrl: "https://example.com/rec.mp3",
  }),
});

assert.deepEqual(
  inferred,
  {
    ghlUserId: null,
    name: "Matias",
    number: "+529841679017",
    index: 1,
    inferred: true,
  },
  "should infer the answered seller from the final transfer number when there is human-connection evidence",
);

const unknown = resolveRoundRobinAnsweredAgent({
  resultJson: {
    roundRobin: {
      enabled: true,
      selectedAgentIndex: 0,
      agents: [
        { name: "Eliana", transferNumber: "+529841111111" },
        { name: "Matias", transferNumber: "+529841679017" },
      ],
    },
  },
  transferNumber: "+529841679017",
  hasHumanConnectionEvidence: hasHumanTransferEvidence({
    transferStatus: "ringing",
    postTransferDurationSec: null,
    transferTranscript: null,
    transferRecordingUrl: null,
  }),
});

assert.equal(
  unknown,
  null,
  "without answer metadata or connection evidence, the dashboard should stay uncertain instead of guessing",
);

console.log("metrics round robin resolution tests passed");
