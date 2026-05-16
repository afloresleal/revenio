import assert from "node:assert/strict";
import { shouldPromoteLateTransferSuccess } from "../src/lib/late-transfer-confirmation.js";

assert.equal(
  shouldPromoteLateTransferSuccess({
    currentOutcome: "abandoned",
    postTransferDurationSec: 56,
  }),
  true,
  "late transfer evidence should promote a long connected human leg",
);

assert.equal(
  shouldPromoteLateTransferSuccess({
    currentOutcome: "abandoned",
    postTransferDurationSec: 8,
  }),
  false,
  "short transfer legs should not be promoted late",
);

assert.equal(
  shouldPromoteLateTransferSuccess({
    currentOutcome: "transfer_success",
    postTransferDurationSec: 56,
  }),
  false,
  "already successful transfers should not be promoted again",
);

console.log("late transfer confirmation tests passed");
