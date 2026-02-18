const $ = (id) => document.getElementById(id);

const storageFields = ["lead_name", "to_number"];

for (const key of storageFields) {
  const el = $(key);
  if (!el) continue;
  const stored = localStorage.getItem(key);
  if (stored && !el.value) el.value = stored;
  el.addEventListener("input", () => localStorage.setItem(key, el.value));
}

const DEFAULT_API_BASE =
  window.location.hostname === "localhost" ? "http://localhost:3000" : "https://revenioapi-production.up.railway.app";
const API_BASE = (localStorage.getItem("campaign_api_base") || DEFAULT_API_BASE).replace(/\/$/, "");
const LEAD_SOURCE = "landing_campaign";

const form = $("campaign_form");
const statusEl = $("status");
const resultEl = $("result");
const submitBtn = $("submit_btn");

function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`.trim();
}

function showResult(data) {
  resultEl.hidden = false;
  resultEl.textContent = JSON.stringify(data, null, 2);
}

function validPhone(value) {
  return /^\+?[0-9\s()-]{7,20}$/.test(value.trim());
}

async function post(path, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const error = new Error(data?.error || `request_failed_${resp.status}`);
    error.status = resp.status;
    error.details = data;
    throw error;
  }
  return data;
}

async function get(path) {
  const resp = await fetch(`${API_BASE}${path}`);
  const data = await resp.json().catch(() => ({}));
  return { status: resp.status, data };
}

function mapEndedMessage(statusData) {
  const endedMessage = statusData?.endedMessage || "";
  const endedReason = statusData?.endedReason || "";
  const lower = `${endedReason} ${endedMessage}`.toLowerCase();
  if (lower.includes("unverified") && lower.includes("trial")) {
    return "Llamada bloqueada por Twilio Trial: el numero destino no esta verificado.";
  }
  if (statusData?.status === "ended" && endedMessage) {
    return `Llamada terminada: ${endedMessage}`;
  }
  if (statusData?.status) {
    return `Estado actual: ${statusData.status}`;
  }
  return "Solicitud enviada. Pendiente de estado final.";
}

async function pollAttemptStatus(attemptId) {
  if (!attemptId) return null;
  let last = null;
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const { status, data } = await get(`/lab/call-status/${attemptId}`);
    if (status !== 200) {
      continue;
    }
    last = data;
    if (data?.status === "ended" || data?.status === "in-progress") break;
  }
  return last;
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();

  const lead_name = $("lead_name").value.trim();
  const to_number = $("to_number").value.trim();

  if (!lead_name || !to_number) {
    setStatus("Completa nombre y telefono.", "error");
    return;
  }

  if (!validPhone(to_number)) {
    setStatus("Telefono invalido. Usa formato internacional, por ejemplo +525512345678.", "error");
    return;
  }

  submitBtn.disabled = true;
  setStatus("Disparando llamada...");

  try {
    const payload = {
      to_number,
      lead_name,
      lead_source: LEAD_SOURCE,
    };
    const data = await post("/call/vapi", payload);
    setStatus("Solicitud de llamada enviada.", "ok");
    const attemptStatus = await pollAttemptStatus(data?.attempt_id);
    if (attemptStatus) {
      const msg = mapEndedMessage(attemptStatus);
      const kind = attemptStatus?.status === "ended" && attemptStatus?.endedMessage ? "error" : "ok";
      setStatus(msg, kind);
      showResult({ ...data, attemptStatus });
    } else {
      showResult(data);
    }
    $("lead_name").value = "";
    $("to_number").value = "";
  } catch (error) {
    setStatus(`No se pudo enviar: ${error.message}`, "error");
    showResult({
      error: error.message,
      status: error.status ?? null,
      details: error.details ?? null,
    });
  } finally {
    submitBtn.disabled = false;
  }
});
