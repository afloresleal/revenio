export function normalizeTranscriptText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function canOpenTranscript(value) {
  return normalizeTranscriptText(value).length > 0;
}
