import assert from "node:assert/strict";
import { classifyTransferAnswer } from "../src/lib/transfer-failover.js";
import { buildImmediateWarmTransferHook, shouldAttachWarmTransferHook } from "../src/routes/webhooks.js";

assert.deepEqual(
  classifyTransferAnswer({
    normalizedStatus: "answered",
    dialCallStatus: null,
    answeredBy: null,
  }),
  {
    machineAnswered: false,
    humanAnswered: false,
  },
  "an answered status without AMD evidence must stay provisional",
);

assert.deepEqual(
  classifyTransferAnswer({
    normalizedStatus: "answered",
    dialCallStatus: null,
    answeredBy: "human",
  }),
  {
    machineAnswered: false,
    humanAnswered: true,
  },
  "explicit AMD human detection should mark a human answer",
);

assert.deepEqual(
  classifyTransferAnswer({
    normalizedStatus: "answered",
    dialCallStatus: null,
    answeredBy: "machine_start",
  }),
  {
    machineAnswered: true,
    humanAnswered: false,
  },
  "machine answers must never be treated as human",
);

const warmTransferHook = buildImmediateWarmTransferHook();
const hookMessages = (
  ((warmTransferHook.do as Array<Record<string, unknown>>)[0]?.tool as Record<string, unknown>)
    ?.messages as Array<Record<string, unknown>>
);

assert.equal(
  hookMessages.some((message) => message.type === "request-start"),
  false,
  "warm transfer should not announce an English request-start message",
);

assert.equal(
  shouldAttachWarmTransferHook({ transferNumber: "+525500000000", autoWarmTransferEnabled: undefined }),
  true,
  "campaigns should keep auto warm transfer enabled by default",
);

assert.equal(
  shouldAttachWarmTransferHook({ transferNumber: "+525500000000", autoWarmTransferEnabled: false }),
  false,
  "campaigns can opt out of the auto warm transfer hook",
);

assert.equal(
  shouldAttachWarmTransferHook({ transferNumber: null, autoWarmTransferEnabled: true }),
  false,
  "without a transfer number there is no warm transfer hook to attach",
);

console.log("transfer failover tests passed");
