import assert from "node:assert/strict";
import {
  canOpenTranscript,
  normalizeTranscriptText,
  splitTranscriptSections,
} from "./transcript-modal-utils.js";

assert.equal(normalizeTranscriptText("  Hola mundo  "), "Hola mundo");
assert.equal(normalizeTranscriptText("\n\n"), "");
assert.equal(normalizeTranscriptText(null), "");
assert.equal(canOpenTranscript("AI: Hola"), true);
assert.equal(canOpenTranscript("   "), false);

assert.deepEqual(
  splitTranscriptSections("AI: Hola.\n\nTransfer (humano): Bueno."),
  [
    { label: "AI", content: "Hola." },
    { label: "Transfer (humano)", content: "Bueno." },
  ],
);

console.log("transcript modal utils tests passed");
