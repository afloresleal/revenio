import assert from "node:assert/strict";
import { determineOutcome } from "../src/lib/sentiment.js";

assert.equal(
  determineOutcome(false, "customer-did-not-answer"),
  "voicemail",
  "customer-did-not-answer should be treated as voicemail for reporting",
);

assert.equal(
  determineOutcome(false, "voicemail-beep"),
  "voicemail",
  "existing voicemail reasons should remain voicemail",
);

console.log("sentiment tests passed");
