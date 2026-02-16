const $ = (id) => document.getElementById(id);

const fields = [
  "api_base",
  "vapi_api_key",
  "vapi_assistant_id",
  "vapi_phone_number_id",
  "to_number",
  "lead_name",
  "lead_source",
  "lead_id",
  "filter_status",
  "filter_lead",
  "filter_from",
  "filter_to",
];

fields.forEach((k) => {
  const v = localStorage.getItem(k);
  if (v) $(k).value = v;
});

fields.forEach((k) => {
  $(k).addEventListener("input", () => localStorage.setItem(k, $(k).value));
});

if (!$('api_base').value) {
  $('api_base').value =
    window.location.hostname === "localhost"
      ? "http://localhost:3000"
      : "https://revenioapi-production.up.railway.app";
}

const out = $("out");
const historyEl = $("history");
const assistantSelect = $("assistant_select");
const phoneSelect = $("phone_select");
let lastHistory = null;

const apiBase = () => $("api_base").value.trim().replace(/\/$/, "");

async function post(path, body) {
  try {
    const resp = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, data };
  } catch (error) {
    return {
      status: 0,
      data: {
        error: "network_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function get(path) {
  try {
    const resp = await fetch(`${apiBase()}${path}`);
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, data };
  } catch (error) {
    return {
      status: 0,
      data: {
        error: "network_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

$("btn_validate").addEventListener("click", async () => {
  out.textContent = "Validando IDs...";
  const payload = {
    vapi_api_key: $("vapi_api_key").value.trim(),
    vapi_assistant_id: $("vapi_assistant_id").value.trim(),
    vapi_phone_number_id: $("vapi_phone_number_id").value.trim(),
  };
  const result = await post("/vapi/validate", payload);
  out.textContent = JSON.stringify(result, null, 2);
});

$("btn_load_assistants").addEventListener("click", async () => {
  out.textContent = "Cargando assistants...";
  const payload = { vapi_api_key: $("vapi_api_key").value.trim() };
  const result = await post("/vapi/assistants", payload);
  if (result.status !== 200 || !Array.isArray(result.data)) {
    out.textContent = JSON.stringify(result, null, 2);
    return;
  }
  const currentAssistantId = $("vapi_assistant_id").value.trim();
  assistantSelect.innerHTML = "";
  result.data.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = `${a.name ?? "assistant"} — ${a.id}`;
    assistantSelect.appendChild(opt);
  });
  if (assistantSelect.options.length) {
    const optionValues = Array.from(assistantSelect.options).map((o) => o.value);
    const selectedValue = optionValues.includes(currentAssistantId) ? currentAssistantId : assistantSelect.options[0].value;
    assistantSelect.value = selectedValue;
    $("vapi_assistant_id").value = selectedValue;
  }
  out.textContent = `Assistants cargados: ${result.data.length}`;
});

$("btn_load_numbers").addEventListener("click", async () => {
  out.textContent = "Cargando números...";
  const payload = { vapi_api_key: $("vapi_api_key").value.trim() };
  const result = await post("/vapi/phone-numbers", payload);
  if (result.status !== 200 || !Array.isArray(result.data)) {
    out.textContent = JSON.stringify(result, null, 2);
    return;
  }
  const currentPhoneNumberId = $("vapi_phone_number_id").value.trim();
  phoneSelect.innerHTML = "";
  result.data.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.number ?? "phone"} — ${p.id}`;
    phoneSelect.appendChild(opt);
  });
  if (phoneSelect.options.length) {
    const optionValues = Array.from(phoneSelect.options).map((o) => o.value);
    const selectedValue = optionValues.includes(currentPhoneNumberId) ? currentPhoneNumberId : phoneSelect.options[0].value;
    phoneSelect.value = selectedValue;
    $("vapi_phone_number_id").value = selectedValue;
  }
  out.textContent = `Números cargados: ${result.data.length}`;
});

assistantSelect.addEventListener("change", () => {
  $("vapi_assistant_id").value = assistantSelect.value;
});

phoneSelect.addEventListener("change", () => {
  $("vapi_phone_number_id").value = phoneSelect.value;
});

$("btn_call").addEventListener("click", async () => {
  out.textContent = "Enviando...";
  const payload = {
    vapi_api_key: $("vapi_api_key").value.trim(),
    vapi_assistant_id: $("vapi_assistant_id").value.trim(),
    vapi_phone_number_id: $("vapi_phone_number_id").value.trim(),
    to_number: $("to_number").value.trim(),
    lead_name: $("lead_name").value.trim(),
    lead_source: $("lead_source").value.trim(),
    lead_id: $("lead_id").value.trim() || undefined,
  };
  const result = await post("/call/test/direct", payload);
  out.textContent = JSON.stringify(result, null, 2);
  await loadHistory();
});

$("btn_load").addEventListener("click", async () => {
  await loadHistory();
});

if ($("btn_apply_filters")) {
  $("btn_apply_filters").addEventListener("click", async () => {
    await loadHistory();
  });
}

function exportCsv() {
  if (!lastHistory?.attempts?.length) {
    out.textContent = "No hay historial para exportar.";
    return;
  }
  const rows = [
    [
      "attempt_id",
      "lead_id",
      "lead_name",
      "phone",
      "status",
      "provider_id",
      "created_at",
    ],
  ];
  lastHistory.attempts.forEach((a) => {
    rows.push([
      a.id,
      a.leadId,
      a.lead?.name ?? "",
      a.lead?.phone ?? "",
      a.status ?? "",
      a.providerId ?? "",
      a.createdAt,
    ]);
  });
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replaceAll("\"", "\"\"")}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `revenio_calls_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

$("btn_export").addEventListener("click", exportCsv);

async function loadHistory() {
  historyEl.textContent = "Cargando...";
  const params = new URLSearchParams();
  params.set("limit", "50");
  const from = $("filter_from")?.value.trim();
  const to = $("filter_to")?.value.trim();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const result = await get(`/lab/history?${params.toString()}`);
  if (result.status !== 200 || !result.data?.attempts) {
    historyEl.textContent = "No se pudo cargar el historial.";
    return;
  }

  lastHistory = result.data;
  let attempts = result.data.attempts;
  const events = result.data.events ?? [];
  const byLead = new Map();
  const byAttempt = new Map();
  const attemptsByProvider = new Map(
    attempts.filter((a) => !!a.providerId).map((a) => [a.providerId, a.id])
  );

  const getAttemptId = (ev) =>
    ev?.detail?.attempt_id ||
    ev?.detail?.attemptId ||
    ev?.detail?.assistantOverrides?.metadata?.attempt_id ||
    ev?.detail?.assistantOverrides?.metadata?.attemptId ||
    ev?.detail?.message?.call?.metadata?.attempt_id ||
    ev?.detail?.message?.call?.metadata?.attemptId ||
    ev?.detail?.call?.assistantOverrides?.metadata?.attempt_id ||
    ev?.detail?.call?.assistantOverrides?.metadata?.attemptId ||
    ev?.detail?.call?.metadata?.attempt_id ||
    ev?.detail?.call?.metadata?.attemptId ||
    ev?.detail?.metadata?.attempt_id ||
    ev?.detail?.metadata?.attemptId ||
    null;

  const getProviderId = (ev) =>
    ev?.detail?.id ||
    ev?.detail?.call?.id ||
    ev?.detail?.message?.call?.id ||
    null;

  events.forEach((ev) => {
    const arr = byLead.get(ev.leadId) ?? [];
    arr.push(ev);
    byLead.set(ev.leadId, arr);
    const attemptId = getAttemptId(ev) || attemptsByProvider.get(getProviderId(ev));
    if (attemptId) {
      const list = byAttempt.get(attemptId) ?? [];
      list.push(ev);
      byAttempt.set(attemptId, list);
    }
  });

  historyEl.innerHTML = "";
  if (!attempts.length) {
    historyEl.textContent = "Sin datos.";
    return;
  }

  const statusFilter = $("filter_status")?.value.trim().toLowerCase();
  const leadFilter = $("filter_lead")?.value.trim().toLowerCase();
  if (statusFilter) {
    attempts = attempts.filter((a) => (a.status ?? "").toLowerCase().includes(statusFilter));
  }
  if (leadFilter) {
    attempts = attempts.filter((a) => {
      const name = (a.lead?.name ?? "").toLowerCase();
      const phone = (a.lead?.phone ?? "").toLowerCase();
      return name.includes(leadFilter) || phone.includes(leadFilter);
    });
  }

  if (!attempts.length) {
    historyEl.textContent = "Sin datos con esos filtros.";
    return;
  }

  attempts.forEach((a) => {
    const evs = byAttempt.get(a.id) ?? byLead.get(a.leadId) ?? [];
    const latest = evs.slice(0, 3);
    const latestJson = latest[0]?.detail ? JSON.stringify(latest[0].detail, null, 2) : null;
    const extractTranscript = (ev) =>
      ev?.detail?.transcript ||
      ev?.detail?.message?.transcript ||
      ev?.detail?.artifact?.transcript ||
      ev?.detail?.message?.artifact?.transcript ||
      null;

    const extractRecording = (ev) =>
      ev?.detail?.recordingUrl ||
      ev?.detail?.message?.recordingUrl ||
      ev?.detail?.artifact?.recording?.mono?.combinedUrl ||
      ev?.detail?.recording?.mono?.combinedUrl ||
      null;

    const extractStereo = (ev) =>
      ev?.detail?.stereoRecordingUrl ||
      ev?.detail?.message?.stereoRecordingUrl ||
      ev?.detail?.recording?.stereoUrl ||
      ev?.detail?.message?.recording?.stereoUrl ||
      null;

    const vapiResultWithTranscript =
      evs.find((e) => e.type === "vapi_result" && extractTranscript(e)) ??
      evs.find((e) => e.type === "vapi_result");

    const transcript = vapiResultWithTranscript ? extractTranscript(vapiResultWithTranscript) : null;
    const recordingUrl = vapiResultWithTranscript ? extractRecording(vapiResultWithTranscript) : null;
    const stereoUrl = vapiResultWithTranscript ? extractStereo(vapiResultWithTranscript) : null;
    const transcriptLines = transcript
      ? transcript
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
      : [];
    const transcriptChat = transcriptLines
      .map((line) => {
        const isAI = line.startsWith("AI:");
        const isUser = line.startsWith("User:");
        const role = isAI ? "AI" : isUser ? "User" : "Note";
        const text = line.replace(/^AI:\s?/, "").replace(/^User:\s?/, "");
        const cls = isAI ? "ai" : isUser ? "user" : "note";
        return `<div class="msg ${cls}"><div class="role">${role}</div><div>${text}</div></div>`;
      })
      .join("");
    const resultJson = a.resultJson ?? vapiResultWithTranscript?.detail ?? null;
    const finalStatus = resultJson?.status ?? null;
    const endedReason = resultJson?.endedReason ?? null;
    const endedMessage = resultJson?.endedMessage ?? null;
    const finalError = endedMessage || endedReason;
    const outcomeClass = finalError ? "error" : finalStatus === "ended" ? "ok" : "neutral";
    const outcomeText = finalError
      ? `Llamada fallida: ${endedMessage || endedReason}`
      : finalStatus
      ? `Estado final: ${finalStatus}`
      : "Sin estado final recibido";
    const el = document.createElement("div");
    const canSyncTranscript = !transcript && !!a.providerId;
    el.className = "item";
    el.innerHTML = `
      <div><strong>${a.lead?.name ?? "(sin nombre)"}</strong> — ${a.lead?.phone ?? ""}</div>
      <small>${new Date(a.createdAt).toLocaleString()} • status: ${a.status ?? "-"}</small>
      <div>attemptId: ${a.id}</div>
      <div>providerId: ${a.providerId ?? "-"}</div>
      <div class="call-outcome ${outcomeClass}">${outcomeText}</div>
      <div class="history-actions">
        <span class="pill">${a.status ?? "unknown"}</span>
        <button class="ghost" data-retry="${a.leadId}" data-phone="${a.lead?.phone ?? ""}">Reintentar llamada</button>
        ${canSyncTranscript ? `<button class="ghost" data-sync-transcript="${a.id}">Sincronizar transcript</button>` : ""}
      </div>
      ${recordingUrl || stereoUrl ? `<div class="links" style="margin-top:6px;">
        ${recordingUrl ? `<a href="${recordingUrl}" target="_blank" rel="noreferrer">Audio (mono)</a>` : ""}
        ${recordingUrl && stereoUrl ? " · " : ""}
        ${stereoUrl ? `<a href="${stereoUrl}" target="_blank" rel="noreferrer">Audio (stereo)</a>` : ""}
      </div>` : ""}
      <div style="margin-top:6px;">
        ${latest.map((e) => `<small>${new Date(e.createdAt).toLocaleTimeString()} — ${e.type}</small>`).join("<br/>")}
      </div>
      <details>
        <summary>Ver eventos completos</summary>
        <div style="margin-top:6px;">
          ${evs.map((e) => `<small>${new Date(e.createdAt).toLocaleString()} — ${e.type}</small>`).join("<br/>") || "<small>Sin eventos</small>"}
        </div>
      </details>
      ${
        transcript
          ? `<details open><summary>Transcript</summary>
              <div class="history-actions" style="margin-top:8px;">
                <button class="ghost" data-copy-transcript="${a.id}">Copiar transcript</button>
              </div>
              <div class="chat">${transcriptChat}</div>
            </details>`
          : ""
      }
      ${latestJson ? `<details><summary>Ver JSON último evento</summary><pre class=\"json\">${latestJson}</pre></details>` : ""}
    `;
    historyEl.appendChild(el);
  });

  historyEl.querySelectorAll("button[data-retry]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      const leadId = ev.currentTarget.getAttribute("data-retry");
      const phone = ev.currentTarget.getAttribute("data-phone");
      if (!leadId) return;
      out.textContent = "Reintentando llamada...";
      const payload = {
        vapi_api_key: $("vapi_api_key").value.trim(),
        vapi_assistant_id: $("vapi_assistant_id").value.trim(),
        vapi_phone_number_id: $("vapi_phone_number_id").value.trim(),
        to_number: phone || $("to_number").value.trim(),
        lead_id: leadId,
      };
      const result = await post("/call/test/direct", payload);
      out.textContent = JSON.stringify(result, null, 2);
      await loadHistory();
    });
  });

  historyEl.querySelectorAll("button[data-copy-transcript]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      const attemptId = ev.currentTarget.getAttribute("data-copy-transcript");
      const evs = byAttempt.get(attemptId) ?? byLead.get(attemptId) ?? [];
      const extractTranscript = (ev) =>
        ev?.detail?.transcript ||
        ev?.detail?.message?.transcript ||
        ev?.detail?.artifact?.transcript ||
        ev?.detail?.message?.artifact?.transcript ||
        null;
      const vapiResultWithTranscript = evs.find((e) => e.type === "vapi_result" && extractTranscript(e));
      const transcript = vapiResultWithTranscript ? extractTranscript(vapiResultWithTranscript) : null;
      if (!transcript) {
        out.textContent = "No hay transcript para copiar.";
        return;
      }
      await navigator.clipboard.writeText(transcript);
      out.textContent = "Transcript copiado.";
    });
  });

  historyEl.querySelectorAll("button[data-sync-transcript]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      const attemptId = ev.currentTarget.getAttribute("data-sync-transcript");
      if (!attemptId) return;
      out.textContent = "Sincronizando transcript desde Vapi...";
      try {
        const result = await post(`/lab/sync-attempt/${attemptId}`, {});
        out.textContent = JSON.stringify(result, null, 2);
        await loadHistory();
      } catch (error) {
        out.textContent = JSON.stringify(
          {
            error: error.message,
          },
          null,
          2
        );
      }
    });
  });
}

loadHistory().catch(() => {});
