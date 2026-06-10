export function normalizeTranscriptText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function canOpenTranscript(value) {
  return normalizeTranscriptText(value).length > 0;
}

export function splitTranscriptSections(value) {
  const normalized = normalizeTranscriptText(value);
  if (!normalized) return [];

  const transferMarker = "Transfer (humano):";
  const transferIndex = normalized.indexOf(transferMarker);

  if (transferIndex === -1) {
    const aiContent = normalized.replace(/^AI:\s*/g, "").trim();
    return aiContent ? [{ label: "AI", content: aiContent }] : [];
  }

  const aiRaw = normalized.slice(0, transferIndex).trim();
  const transferRaw = normalized.slice(transferIndex + transferMarker.length).trim();
  const aiContent = aiRaw.replace(/^AI:\s*/g, "").replace(/\nAI:\s*/g, "\n").trim();
  const sections = [];

  if (aiContent) sections.push({ label: "AI", content: aiContent });
  if (transferRaw) sections.push({ label: "Transfer (humano)", content: transferRaw });

  return sections;
}
