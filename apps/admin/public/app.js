const $ = (id) => document.getElementById(id);
const LOCAL_API_BASE_URL = "http://localhost:3000";
const RAILWAY_API_BASE_URL = "https://revenioapi-production.up.railway.app";

const fields = [
  "client_name",
  "campaign_name",
  "campaign_id",
  "property_key",
  "language",
  "vapi_assistant_id",
  "vapi_phone_number_id",
  "ghl_location_id",
  "ghl_pipeline_id",
  "ghl_stage_id",
  "campaign_active",
  "fallback_name",
  "fallback_user_id",
  "fallback_phone",
  "test_phone",
  "test_name",
];

const statusEl = $("status");
const campaignFeedbackEl = $("campaign_feedback");
const agentsFeedbackEl = $("agents_feedback");
const callsFeedbackEl = $("calls_feedback");
const campaignListEl = $("campaign_list");
const agentRowsEl = $("agent_rows");
let campaigns = [];
let selectedCampaignId = null;
let selectedCampaign = null;
let isCreatingCampaign = false;
let agentsLoadToken = 0;

fields.forEach((id) => {
  const value = localStorage.getItem(`admin_${id}`);
  const el = $(id);
  if (!el || value == null) return;
  if (el.type === "checkbox") {
    el.checked = value === "true";
    return;
  }
  el.value = value;
});

fields.forEach((id) => {
  const el = $(id);
  if (!el) return;
  const handler = () => {
    localStorage.setItem(`admin_${id}`, el.type === "checkbox" ? String(el.checked) : el.value);
  };
  el.addEventListener("input", handler);
  el.addEventListener("change", handler);
});

function apiBase() {
  const isLocal = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
  return isLocal ? LOCAL_API_BASE_URL : RAILWAY_API_BASE_URL;
}

function setStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

function setCampaignFeedback(message = "", type = "info") {
  campaignFeedbackEl.textContent = message;
  campaignFeedbackEl.hidden = !message;
  campaignFeedbackEl.classList.toggle("is-error", type === "error");
}

function setAgentsFeedback(message = "", type = "info") {
  agentsFeedbackEl.textContent = message;
  agentsFeedbackEl.hidden = !message;
  agentsFeedbackEl.classList.toggle("is-error", type === "error");
}

function setCallsFeedback(message = "", type = "info") {
  callsFeedbackEl.textContent = message;
  callsFeedbackEl.hidden = !message;
  callsFeedbackEl.classList.toggle("is-error", type === "error");
}

function clearCampaignFieldErrors() {
  [
    "campaign_name",
    "campaign_id",
    "vapi_assistant_id",
    "vapi_phone_number_id",
  ].forEach((id) => $(id).classList.remove("field-error"));
}

function clearAgentFieldErrors() {
  for (let i = 1; i <= 5; i += 1) {
    $(`agent_name_${i}`)?.classList.remove("field-error");
    $(`agent_phone_${i}`)?.classList.remove("field-error");
  }
  $("fallback_user_id")?.classList.remove("field-error");
  $("fallback_phone").classList.remove("field-error");
}

function validateCampaignPayload(payload) {
  clearCampaignFieldErrors();
  const missing = [];
  [
    ["campaign_name", "Nombre", payload.name],
    ["campaign_id", "Campaign ID", payload.campaignId],
    ["vapi_assistant_id", "Vapi Assistant ID", payload.vapiAssistantId],
    ["vapi_phone_number_id", "Vapi Phone Number ID", payload.vapiPhoneNumberId],
  ].forEach(([id, label, value]) => {
    if (String(value || "").trim()) return;
    missing.push(label);
    $(id).classList.add("field-error");
  });

  if (missing.length) {
    return `Faltan campos obligatorios: ${missing.join(", ")}.`;
  }
  if (payload.vapiAssistantId.length < 6) {
    $("vapi_assistant_id").classList.add("field-error");
    return "Vapi Assistant ID debe tener al menos 6 caracteres.";
  }
  if (payload.vapiPhoneNumberId.length < 6) {
    $("vapi_phone_number_id").classList.add("field-error");
    return "Vapi Phone Number ID debe tener al menos 6 caracteres.";
  }
  return "";
}

async function request(method, path, body) {
  const resp = await fetch(`${apiBase()}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error || data?.message || `Error ${resp.status}`);
  }
  return data;
}

function emptyAgentRows() {
  agentRowsEl.innerHTML = "";
  for (let i = 1; i <= 5; i += 1) {
    const row = document.createElement("div");
    row.className = "agent-row";
    row.innerHTML = `
      <div class="row-label">Agente ${i}</div>
      <label>Nombre<input id="agent_name_${i}" placeholder="Ana" /></label>
      <label>GHL User ID <span class="label-muted">opcional</span><input id="agent_user_${i}" placeholder="Se puede dejar vacio" /></label>
      <label>Teléfono<input id="agent_phone_${i}" placeholder="+5255..." /></label>
      <label class="toggle-row"><input id="agent_active_${i}" type="checkbox" checked />Activo</label>
    `;
    agentRowsEl.appendChild(row);
  }
}

function collectCampaignPayload() {
  const campaignName = $("campaign_name").value.trim();
  const campaignId = $("campaign_id").value.trim();
  const payload = {
    name: campaignName,
    campaignId,
    clientName: $("client_name").value.trim() || undefined,
    propertyKey: campaignId || campaignName,
    language: $("language").value,
    vapiAssistantId: $("vapi_assistant_id").value.trim(),
    vapiPhoneNumberId: $("vapi_phone_number_id").value.trim(),
    ghlLocationId: $("ghl_location_id").value.trim() || undefined,
    ghlPipelineId: $("ghl_pipeline_id").value.trim() || undefined,
    ghlStageId: $("ghl_stage_id").value.trim() || undefined,
    active: $("campaign_active").checked,
  };
  const ghlApiKey = $("ghl_api_key").value.trim();
  if (ghlApiKey) payload.ghlApiKey = ghlApiKey;
  return payload;
}

function updateCampaignActiveLabel() {
  const isActive = $("campaign_active").checked;
  $("campaign_active_label").textContent = isActive ? "Campaña activa" : "Campaña pausada";
  $("campaign_mode_badge").classList.toggle("is-paused", !isActive && Boolean(selectedCampaign));
}

function applyCampaign(campaign) {
  selectedCampaign = campaign;
  selectedCampaignId = campaign?.id ?? null;
  isCreatingCampaign = !campaign;
  $("client_name").value = campaign?.clientName ?? "";
  $("campaign_name").value = campaign?.name ?? "";
  $("campaign_id").value = campaign?.campaignId ?? "";
  $("property_key").value = campaign?.propertyKey ?? "";
  $("language").value = campaign?.language ?? "es";
  $("vapi_assistant_id").value = campaign?.vapiAssistantId ?? "";
  $("vapi_phone_number_id").value = campaign?.vapiPhoneNumberId ?? "";
  $("ghl_location_id").value = campaign?.ghlLocationId ?? "";
  $("ghl_api_key").value = "";
  $("ghl_api_key_status").textContent = campaign?.ghlApiKeyConfigured ? "API key configurada" : "No configurada";
  $("ghl_pipeline_id").value = campaign?.ghlPipelineId ?? "";
  $("ghl_stage_id").value = campaign?.ghlStageId ?? "";
  $("campaign_active").checked = campaign?.active !== false;
  $("campaign_form_title").textContent = campaign ? "Editar campaña" : "Nueva campaña";
  $("campaign_mode_badge").textContent = campaign ? (campaign.active === false ? "Pausada" : "Editando") : "Creando";
  $("campaign_mode_badge").classList.toggle("is-editing", Boolean(campaign));
  $("btn_save_campaign").textContent = campaign ? "Guardar cambios" : "Crear campaña";
  updateCampaignActiveLabel();
  clearCampaignFieldErrors();
  clearAgentFieldErrors();
  setCampaignFeedback("");
  setAgentsFeedback(campaign ? `Editando agentes de ${campaign.name}.` : "Guarda o selecciona una campaña antes de capturar agentes.");
  setCallsFeedback(campaign ? `CSV listo para ${campaign.name}.` : "Selecciona o crea una campaña para descargar llamadas.");
  renderCampaignList();
  renderWebhookInstructions(campaign?.webhookInstructions ?? null);
  loadAgents().catch((error) => setStatus(error.message));
}

function startNewCampaign() {
  applyCampaign(null);
  document.querySelector('[data-panel="campaign"]')?.click();
  $("campaign_name").focus();
  setStatus("Nueva campaña lista. Captura los datos y presiona Crear campaña.");
}

function renderCampaignList() {
  if (!campaigns.length) {
    campaignListEl.textContent = "No hay campañas todavía.";
    return;
  }
  campaignListEl.innerHTML = "";
  campaigns.forEach((campaign) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `campaign-item${campaign.id === selectedCampaignId ? " is-active" : ""}`;
    const statusClass = campaign.active === false ? " is-paused" : "";
    const statusText = campaign.active === false ? "Pausada" : "Activa";
    button.innerHTML = `
      ${campaign.name}
      <span class="campaign-meta">${campaign.clientName || "Sin cliente"} · ${campaign.campaignId}</span>
      <span class="campaign-status${statusClass}">${statusText}</span>
    `;
    button.addEventListener("click", () => applyCampaign(campaign));
    campaignListEl.appendChild(button);
  });
}

async function loadCampaigns() {
  setStatus("Cargando campañas...");
  const data = await request("GET", "/api/admin/ghl-campaigns");
  campaigns = data.campaigns ?? [];
  renderCampaignList();
  const current = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? campaigns[0] ?? null;
  if (current && !isCreatingCampaign) applyCampaign(current);
  if (!current) applyCampaign(null);
  setStatus("Campañas cargadas.");
}

async function saveCampaign() {
  const payload = collectCampaignPayload();
  const validationError = validateCampaignPayload(payload);
  if (validationError) {
    setCampaignFeedback(validationError, "error");
    setStatus(validationError);
    return;
  }
  const path = selectedCampaignId ? `/api/admin/ghl-campaigns/${selectedCampaignId}` : "/api/admin/ghl-campaigns";
  const method = selectedCampaignId ? "PUT" : "POST";
  setStatus("Guardando campaña...");
  setCampaignFeedback("Guardando campaña...");
  const data = await request(method, path, payload);
  await loadCampaigns();
  applyCampaign(data.campaign);
  const activeMessage = data.campaign.active === false
    ? "Campaña pausada. Revenio no disparará llamadas desde GHL para esta campaña."
    : "Campaña activa. Ahora puedes configurar agentes y copiar el entregable de GHL.";
  setCampaignFeedback(activeMessage);
  setStatus(data.campaign.active === false ? "Campaña pausada." : "Campaña guardada.");
}

function agentScopeQuery() {
  const propertyKey = selectedCampaign?.propertyKey || $("property_key").value || "ghl_test";
  const campaignId = selectedCampaign?.campaignId || $("campaign_id").value.trim();
  const params = new URLSearchParams({ propertyKey });
  if (campaignId) params.set("campaignId", campaignId);
  return params.toString();
}

function collectAgents() {
  const agents = [];
  const propertyKey = selectedCampaign?.propertyKey || $("property_key").value || "ghl_test";
  const campaignId = selectedCampaign?.campaignId || $("campaign_id").value.trim() || "default";
  for (let i = 1; i <= 5; i += 1) {
    const capturedName = $(`agent_name_${i}`)?.value.trim();
    const ghlUserId = $(`agent_user_${i}`)?.value.trim() || `${propertyKey}:${campaignId}:agent-${i}`;
    const transferNumber = $(`agent_phone_${i}`)?.value.trim();
    const active = $(`agent_active_${i}`)?.checked ?? true;
    if (!capturedName && !transferNumber) continue;
    const name = capturedName || `Agente ${i}`;
    agents.push({ name, ghlUserId, transferNumber, priority: i, active });
  }
  return agents;
}

function validateAgentPayload(agents, fallback) {
  clearAgentFieldErrors();
  if (!selectedCampaign) {
    return "Selecciona o crea una campaña antes de guardar agentes.";
  }

  let firstError = "";
  for (let i = 1; i <= 5; i += 1) {
    const name = $(`agent_name_${i}`)?.value.trim();
    const phone = $(`agent_phone_${i}`)?.value.trim();
    if (name && !phone) {
      $(`agent_phone_${i}`).classList.add("field-error");
      firstError ||= `Agente ${i}: falta el teléfono.`;
    }
    if (phone && phone.length < 6) {
      $(`agent_phone_${i}`).classList.add("field-error");
      firstError ||= `Agente ${i}: el teléfono debe tener al menos 6 caracteres.`;
    }
  }

  if (!agents.length && !fallback.transferNumber) {
    return "Captura al menos un vendedor con teléfono o un fallback final.";
  }
  if (fallback.transferNumber && fallback.transferNumber.length < 6) {
    $("fallback_phone").classList.add("field-error");
    return "Fallback final: el teléfono debe tener al menos 6 caracteres.";
  }
  return firstError;
}

function applyAgents(data) {
  emptyAgentRows();
  (data.agents ?? []).slice(0, 5).forEach((agent, index) => {
    const row = index + 1;
    $(`agent_name_${row}`).value = agent.name ?? "";
    $(`agent_user_${row}`).value = agent.ghlUserId ?? agent.ghl_user_id ?? "";
    $(`agent_phone_${row}`).value = agent.transferNumber ?? agent.transfer_number ?? "";
    $(`agent_active_${row}`).checked = agent.active !== false;
  });
  $("fallback_name").value = data.fallback?.name ?? "";
  $("fallback_user_id").value = data.fallback?.ghlUserId ?? data.fallback?.ghl_user_id ?? "";
  $("fallback_phone").value = data.fallback?.transferNumber ?? "";
}

async function loadAgents() {
  const token = ++agentsLoadToken;
  const campaignAtRequest = selectedCampaign?.id ?? null;
  if (!selectedCampaign) {
    applyAgents({ agents: [], fallback: {} });
    return;
  }
  setAgentsFeedback(`Cargando agentes de ${selectedCampaign.name}...`);
  const data = await request("GET", `/api/admin/ghl-agents?${agentScopeQuery()}`);
  if (token !== agentsLoadToken || campaignAtRequest !== selectedCampaign?.id) return;
  applyAgents(data);
  setAgentsFeedback(`Agentes cargados para ${selectedCampaign.name}.`);
}

async function saveAgents() {
  const agents = collectAgents();
  const fallback = {
    name: $("fallback_name").value.trim() || undefined,
    ghlUserId: $("fallback_user_id").value.trim() || undefined,
    transferNumber: $("fallback_phone").value.trim() || undefined,
  };
  const validationError = validateAgentPayload(agents, fallback);
  if (validationError) {
    setAgentsFeedback(validationError, "error");
    setStatus(validationError);
    return;
  }
  setStatus("Guardando agentes...");
  setAgentsFeedback(`Guardando agentes de ${selectedCampaign.name}...`);
  await request("PUT", "/api/admin/ghl-agents", {
    propertyKey: selectedCampaign.propertyKey,
    campaignId: selectedCampaign.campaignId,
    agents,
    fallback,
  });
  await loadAgents();
  setAgentsFeedback(`Agentes guardados para ${selectedCampaign.name}.`);
  setStatus("Agentes guardados.");
}

async function runTestCall() {
  if (!selectedCampaignId) {
    setStatus("Guarda o selecciona una campaña antes de probar.");
    return;
  }
  const toNumber = $("test_phone").value.trim();
  if (!toNumber) {
    setStatus("Captura el teléfono del lead para la prueba.");
    return;
  }
  setStatus("Lanzando llamada de prueba...");
  const data = await request("POST", `/api/admin/ghl-campaigns/${selectedCampaignId}/test-call`, {
    toNumber,
    leadName: $("test_name").value.trim() || undefined,
  });
  const selected = data.selected_agent;
  setStatus(`Prueba enviada. Transferencia: ${selected?.human_agent_name || "Fallback"} · ${selected?.transfer_number || ""}`);
}

async function downloadCallsCsv() {
  if (!selectedCampaignId || !selectedCampaign) {
    setCallsFeedback("Selecciona o crea una campaña antes de descargar CSV.", "error");
    setStatus("Selecciona o crea una campaña antes de descargar CSV.");
    return;
  }
  setCallsFeedback(`Preparando CSV de ${selectedCampaign.name}...`);
  setStatus("Preparando CSV...");
  const resp = await fetch(`${apiBase()}/api/admin/ghl-campaigns/${selectedCampaignId}/calls.csv`);
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data?.error || data?.message || `Error ${resp.status}`);
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeCampaignId = selectedCampaign.campaignId.replace(/[^a-zA-Z0-9_-]+/g, "-") || "campaign";
  link.href = url;
  link.download = `revenio-${safeCampaignId}-calls.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setCallsFeedback("CSV descargado.");
  setStatus("CSV descargado.");
}

function renderWebhookInstructions(instructions) {
  const webhookTable = $("webhook_table");
  const customDataTable = $("custom_data_table");
  const validationList = $("validation_list");
  webhookTable.innerHTML = "";
  customDataTable.innerHTML = "";
  validationList.innerHTML = "";
  if (!instructions) {
    webhookTable.innerHTML = "<tr><td>Guarda una campaña para generar instrucciones.</td></tr>";
    return;
  }

  [
    ["Action name", "Revenio - Crear llamada"],
    ["Method", instructions.method],
    ["URL staging", instructions.stagingUrl],
    ["URL production", instructions.productionUrl],
  ].forEach(([label, value]) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${label}</td><td>${value}</td>`;
    webhookTable.appendChild(row);
  });

  instructions.customDataRows.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${item.key}</td><td>${item.value}</td>`;
    customDataTable.appendChild(row);
  });

  instructions.validations.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    validationList.appendChild(li);
  });
}

function handoffText() {
  const instructions = selectedCampaign?.webhookInstructions;
  if (!instructions) return "Guarda una campaña para generar instrucciones.";
  const lines = [
    "Configuración Webhook GHL",
    `Method: ${instructions.method}`,
    `URL staging: ${instructions.stagingUrl}`,
    `URL production: ${instructions.productionUrl}`,
    "",
    "Custom Data:",
    ...instructions.customDataRows.map((row) => `${row.key}: ${row.value}`),
    "",
    "Validaciones:",
    ...instructions.validations.map((item) => `- ${item}`),
  ];
  return lines.join("\n");
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("is-active", item === tab));
    document.querySelectorAll(".panel").forEach((panel) => {
      panel.classList.toggle("is-active", panel.id === `panel_${tab.dataset.panel}`);
    });
  });
});

$("btn_new_campaign").addEventListener("click", startNewCampaign);
$("btn_save_campaign").addEventListener("click", () => saveCampaign().catch((error) => setStatus(error.message)));
$("campaign_active").addEventListener("change", updateCampaignActiveLabel);
$("btn_save_agents").addEventListener("click", () => saveAgents().catch((error) => setStatus(error.message)));
$("btn_test_call")?.addEventListener("click", () => runTestCall().catch((error) => setStatus(error.message)));
$("btn_download_calls_csv").addEventListener("click", () => downloadCallsCsv().catch((error) => {
  setCallsFeedback(error.message, "error");
  setStatus(error.message);
}));
$("btn_copy_handoff").addEventListener("click", async () => {
  await navigator.clipboard.writeText(handoffText());
  setStatus("Instrucciones copiadas.");
});

emptyAgentRows();
loadCampaigns().catch((error) => setStatus(error.message));
