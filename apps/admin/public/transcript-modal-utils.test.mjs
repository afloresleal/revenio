import assert from "node:assert/strict";
import { canOpenTranscript, normalizeTranscriptText } from "./transcript-modal-utils.js";

assert.equal(normalizeTranscriptText("  Hola mundo  "), "Hola mundo");
assert.equal(normalizeTranscriptText("\n\n"), "");
assert.equal(normalizeTranscriptText(null), "");
assert.equal(canOpenTranscript("AI: Hola"), true);
assert.equal(canOpenTranscript("   "), false);

console.log("transcript modal utils tests passed");
