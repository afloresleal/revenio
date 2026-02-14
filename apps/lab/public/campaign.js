const $ = (id) => document.getElementById(id);

const storageFields = [
  "api_base",
  "vapi_api_key",
  "vapi_assistant_id",
  "vapi_phone_number_id",
  "lead_source",
  "lead_name",
  "to_number",
];

for (const key of storageFields) {
  const el = $(key);
  if (!el) continue;
  const stored = localStorage.getItem(key);
  if (stored && !el.value) el.value = stored;
  el.addEventListener("input", () => localStorage.setItem(key, el.value));
}

if (!$("api_base").value) {
  $("api_base").value = "http://localhost:3000";
}
if (!$("lead_source").value) {
  $("lead_source").value = "landing_campaign";
}

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
  const base = $("api_base").value.trim().replace(/\/$/, "");
  const resp = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error || `request_failed_${resp.status}`);
  }
  return data;
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();

  const lead_name = $("lead_name").value.trim();
  const to_number = $("to_number").value.trim();
  const vapi_api_key = $("vapi_api_key").value.trim();
  const vapi_assistant_id = $("vapi_assistant_id").value.trim();
  const vapi_phone_number_id = $("vapi_phone_number_id").value.trim();
  const lead_source = $("lead_source").value.trim() || "landing_campaign";

  if (!lead_name || !to_number) {
    setStatus("Completa nombre y telefono.", "error");
    return;
  }

  if (!validPhone(to_number)) {
    setStatus("Telefono invalido. Usa formato internacional, por ejemplo +525512345678.", "error");
    return;
  }

  if (!vapi_api_key || !vapi_assistant_id || !vapi_phone_number_id) {
    setStatus("Faltan credenciales Vapi en 'Configuracion de campana'.", "error");
    return;
  }

  submitBtn.disabled = true;
  setStatus("Disparando llamada...");

  try {
    const payload = {
      vapi_api_key,
      vapi_assistant_id,
      vapi_phone_number_id,
      to_number,
      lead_name,
      lead_source,
    };
    const data = await post("/call/test/direct", payload);
    setStatus("Llamada enviada correctamente.", "ok");
    showResult(data);
    $("lead_name").value = "";
    $("to_number").value = "";
  } catch (error) {
    setStatus(`No se pudo enviar: ${error.message}`, "error");
    showResult({ error: error.message });
  } finally {
    submitBtn.disabled = false;
  }
});
