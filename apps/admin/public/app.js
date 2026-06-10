import { canOpenTranscript, normalizeTranscriptText } from "./transcript-modal-utils.js";
const $ = (id) => document.getElementById(id);

// API base URLs - updated for correct environment detection
const LOCAL_API_BASE_URL = "http://localhost:3000";
const STAGING_API_BASE_URL = "https://revenioapi-staging.up.railway.app";
const PRODUCTION_API_BASE_URL = "https://revenioapi-production.up.railway.app";

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
  "ghl_connected_stage_id",
  "ghl_outcome_field_id",
  "ghl_answered_agent_field_id",
  "ghl_seller_talk_field_id",
  "ghl_recording_url_field_id",
  "campaign_active",
  "call_window_mode",
  "call_window_timezone",
  "call_window_start_hour",
  "call_window_end_hour",
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
const costsFeedbackEl = $("costs_feedback");
const campaignListEl = $("campaign_list");
const agentRowsEl = $("agent_rows");
const callsSummaryEl = $("calls_summary");
const callsSummaryTotalEl = $("calls_summary_total");
const callsSummaryAnsweredEl = $("calls_summary_answered");
const callsSummaryContactedEl = $("calls_summary_contacted");
const callsSummaryVapiEl = $("calls_summary_vapi");
const callsSummaryTwilioEl = $("calls_summary_twilio");
const callsTableHeadEl = $("calls_table_head");
const callsTableBodyEl = $("calls_table_body");
const callsEmptyEl = $("calls_empty");
const transcriptModalEl = $("transcript_modal");
const transcriptModalTitleEl = $("transcript_modal_title");
const transcriptModalBodyEl = $("transcript_modal_body");
const costsSummary7dTotalUsdEl = $("costs_summary_7d_total_usd");
const costsSummary7dTotalMxnEl = $("costs_summary_7d_total_mxn");
const costsSummaryProjectionUsdEl = $("costs_summary_projection_usd");
const costsSummaryProjectionMxnEl = $("costs_summary_projection_mxn");
const costsSummaryVapiUsdEl = $("costs_summary_vapi_usd");
const costsSummaryVapiMxnEl = $("costs_summary_vapi_mxn");
const costsSummaryTwilioUsdEl = $("costs_summary_twilio_usd");
const costsSummaryTwilioMxnEl = $("costs_summary_twilio_mxn");
const costsSummaryTotalUsdEl = $("costs_summary_total_usd");
const costsSummaryTotalMxnEl = $("costs_summary_total_mxn");
const costsSummaryAvgCallUsdEl = $("costs_summary_avg_call_usd");
const costsSummaryAvgCallMxnEl = $("costs_summary_avg_call_mxn");
const costsSummaryAvgContactedUsdEl = $("costs_summary_avg_contacted_usd");
const costsSummaryAvgContactedMxnEl = $("costs_summary_avg_contacted_mxn");
const costsSummaryTotalCallsEl = $("costs_summary_total_calls");
const costsSummaryRunningDaysEl = $("costs_summary_running_days");
const costsEffectiveNoteEl = $("costs_effective_note");
let campaigns = [];
let selectedCampaignId = null;
let selectedCampaign = null;
let isCreatingCampaign = false;
let agentsLoadToken = 0;
let callsLoadToken = 0;
let costsLoadToken = 0;
let isApplyingCampaign = false;
let campaignDraftDirty = false;

const campaignDraftFields = new Set([
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
  "ghl_connected_stage_id",
  "ghl_outcome_field_id",
  "ghl_answered_agent_field_id",
  "ghl_seller_talk_field_id",
  "ghl_recording_url_field_id",
  "campaign_active",
  "call_window_mode",
  "call_window_timezone",
  "call_window_start_hour",
  "call_window_end_hour",
]);

fields.forEach((id) => {
  const value = localStorage.getItem(`admin_${id}`);
  const el = $(id);
  if (!el || value == null) return;
  if (el.type === "checkbox") {
    el.checked = value === "true";
    return;
  }
  if (el.type === "radio") {
    if (el.value === value) el.checked = true;
    return;
  }
  el.value = value;
});

// Load weekdays checkboxes
const savedWeekdays = localStorage.getItem('admin_call_window_weekdays');
if (savedWeekdays) {
  const days = savedWeekdays.split(',').map(d => d.trim());
  for (let i = 0; i <= 6; i++) {
    const checkbox = $(`call_window_day_${i}`);
    if (checkbox) checkbox.checked = days.includes(String(i));
  }
}

fields.forEach((id) => {
  const el = $(id);
  if (!el) return;
  const handler = () => {
    if (el.type === "radio") {
      if (el.checked) {
        localStorage.setItem(`admin_${id}`, el.value);
        if (!isApplyingCampaign && campaignDraftFields.has(id)) {
          campaignDraftDirty = true;
        }
      }
    } else {
      localStorage.setItem(`admin_${id}`, el.type === "checkbox" ? String(el.checked) : el.value);
      if (!isApplyingCampaign && campaignDraftFields.has(id)) {
        campaignDraftDirty = true;
      }
    }
  };
  el.addEventListener("input", handler);
  el.addEventListener("change", handler);
});

// Save weekdays when changed
for (let i = 0; i <= 6; i++) {
  const checkbox = $(`call_window_day_${i}`);
  if (checkbox) {
    checkbox.addEventListener("change", () => {
      const selectedDays = [];
      for (let j = 0; j <= 6; j++) {
        const cb = $(`call_window_day_${j}`);
        if (cb?.checked) selectedDays.push(j);
      }
      localStorage.setItem('admin_call_window_weekdays', selectedDays.join(','));
      if (!isApplyingCampaign && campaignDraftFields.has('call_window_weekdays')) {
        campaignDraftDirty = true;
      }
    });
  }
}

function updateCallWindowFieldsVisibility() {
  const mode = document.querySelector('input[name="call_window_mode"]:checked')?.value || "global";
  const customFields = $("call_window_custom_fields");
  if (customFields) {
    customFields.style.display = mode === "custom" ? "grid" : "none";
  }
}

function apiBase() {
  const hostname = window.location.hostname;
  const isLocal = ["localhost", "127.0.0.1", ""].includes(hostname);
  let apiUrl;
  if (isLocal) apiUrl = LOCAL_API_BASE_URL;
  else if (hostname.includes("staging")) apiUrl = STAGING_API_BASE_URL;
  else apiUrl = PRODUCTION_API_BASE_URL;
  console.log(`[Admin] hostname: ${hostname} → API: ${apiUrl}`);
  return apiUrl;
}

// Converts direct Twilio recording URLs to our proxy endpoint
function getTwilioProxyUrl(twilioUrl) {
  // Extract Recording SID from URL like:
  // https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/REyyy.mp3
  const match = twilioUrl.match(/Recordings\/(RE[a-f0-9]+)/i);
  if (match && match[1]) {
    const apiUrl = apiBase();
    return `${apiUrl}/api/recordings/${match[1]}`;
  }
  return twilioUrl; // Fallback to original if can't parse
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

function setCostsFeedback(message = "", type = "info") {
  costsFeedbackEl.textContent = message;
  costsFeedbackEl.hidden = !message;
  costsFeedbackEl.classList.toggle("is-error", type === "error");
}

function truncateCell(value, maxLength = 220) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function openTranscriptModal(transcript, phone = "") {
  const normalized = normalizeTranscriptText(transcript);
  if (!normalized || !transcriptModalEl || !transcriptModalBodyEl) return;
  if (transcriptModalTitleEl) {
    transcriptModalTitleEl.textContent = phone ? `Transcript ${phone}` : "Transcript";
  }
  transcriptModalBodyEl.textContent = normalized;
  transcriptModalEl.hidden = false;
}

function closeTranscriptModal() {
  if (!transcriptModalEl || !transcriptModalBodyEl) return;
  transcriptModalEl.hidden = true;
  transcriptModalBodyEl.textContent = "";
}

function formatInteger(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "0";
  return Math.round(numeric).toLocaleString("es-MX");
}

function formatDurationCompact(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds ?? 0) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function formatDecimalInput(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return numeric.toFixed(digits);
}

function formatCurrency(value, currency = "USD") {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

function renderCallsSummary(summary) {
  if (!callsSummaryEl) return;

  if (!selectedCampaign || !summary) {
    callsSummaryTotalEl.textContent = "--";
    callsSummaryAnsweredEl.textContent = "--";
    callsSummaryContactedEl.textContent = "--";
    callsSummaryVapiEl.textContent = "--";
    callsSummaryTwilioEl.textContent = "--";
    return;
  }

  callsSummaryTotalEl.textContent = formatInteger(summary.totalCalls);
  callsSummaryAnsweredEl.textContent = formatInteger(summary.answeredCalls);
  callsSummaryContactedEl.textContent = formatInteger(summary.contactedCalls);
  callsSummaryVapiEl.textContent = formatDurationCompact(summary.totalVapiDurationSec);
  callsSummaryTwilioEl.textContent = formatDurationCompact(summary.totalTwilioDurationSec);
}

function updateCampaignCostOverrideInputs() {
  const enabled = $("costs_override_enabled")?.checked === true;
  $("costs_campaign_vapi_per_minute_usd").disabled = !enabled;
  $("costs_campaign_twilio_per_minute_usd").disabled = !enabled;
}

function applyCampaignCostOverride(campaign) {
  $("costs_override_enabled").checked = campaign?.costOverrideEnabled === true;
  $("costs_campaign_vapi_per_minute_usd").value = formatDecimalInput(campaign?.overrideVapiCostPerMinuteUsd);
  $("costs_campaign_twilio_per_minute_usd").value = formatDecimalInput(campaign?.overrideTwilioCostPerMinuteUsd);
  updateCampaignCostOverrideInputs();
}

function renderCostSummary(data) {
  const emptyUsd = "--";
  const emptyMxn = "--";
  if (!selectedCampaign || !data?.summary) {
    costsSummary7dTotalUsdEl.textContent = emptyUsd;
    costsSummary7dTotalMxnEl.textContent = emptyMxn;
    costsSummaryProjectionUsdEl.textContent = emptyUsd;
    costsSummaryProjectionMxnEl.textContent = emptyMxn;
    costsSummaryVapiUsdEl.textContent = emptyUsd;
    costsSummaryVapiMxnEl.textContent = emptyMxn;
    costsSummaryTwilioUsdEl.textContent = emptyUsd;
    costsSummaryTwilioMxnEl.textContent = emptyMxn;
    costsSummaryTotalUsdEl.textContent = emptyUsd;
    costsSummaryTotalMxnEl.textContent = emptyMxn;
    costsSummaryAvgCallUsdEl.textContent = emptyUsd;
    costsSummaryAvgCallMxnEl.textContent = emptyMxn;
    costsSummaryAvgContactedUsdEl.textContent = emptyUsd;
    costsSummaryAvgContactedMxnEl.textContent = emptyMxn;
    if (costsSummaryTotalCallsEl) costsSummaryTotalCallsEl.textContent = "--";
    if (costsSummaryRunningDaysEl) costsSummaryRunningDaysEl.textContent = "--";
    costsEffectiveNoteEl.textContent = "";
    return;
  }

  const { summary, effectiveConfig } = data;
  const recent = summary.last7Days;
  const total = summary.total;

  costsSummary7dTotalUsdEl.textContent = formatCurrency(recent.totalCostUsd, "USD");
  costsSummary7dTotalMxnEl.textContent = formatCurrency(recent.totalCostMxn, "MXN");
  costsSummaryProjectionUsdEl.textContent = formatCurrency(recent.projectedMonthlyUsd, "USD");
  costsSummaryProjectionMxnEl.textContent = formatCurrency(recent.projectedMonthlyMxn, "MXN");

  costsSummaryVapiUsdEl.textContent = formatCurrency(total.totalVapiCostUsd, "USD");
  costsSummaryVapiMxnEl.textContent = formatCurrency(total.totalVapiCostMxn, "MXN");
  costsSummaryTwilioUsdEl.textContent = formatCurrency(total.totalTwilioCostUsd, "USD");
  costsSummaryTwilioMxnEl.textContent = formatCurrency(total.totalTwilioCostMxn, "MXN");
  costsSummaryTotalUsdEl.textContent = formatCurrency(total.totalCostUsd, "USD");
  costsSummaryTotalMxnEl.textContent = formatCurrency(total.totalCostMxn, "MXN");
  costsSummaryAvgCallUsdEl.textContent = formatCurrency(total.avgCostPerCallUsd, "USD");
  costsSummaryAvgCallMxnEl.textContent = formatCurrency(total.avgCostPerCallMxn, "MXN");
  costsSummaryAvgContactedUsdEl.textContent = formatCurrency(total.avgCostPerContactedUsd, "USD");
  costsSummaryAvgContactedMxnEl.textContent = formatCurrency(total.avgCostPerContactedMxn, "MXN");
  if (costsSummaryTotalCallsEl) costsSummaryTotalCallsEl.textContent = formatInteger(total.totalCalls);
  if (costsSummaryRunningDaysEl) costsSummaryRunningDaysEl.textContent = formatInteger(total.runningDays);
  costsEffectiveNoteEl.textContent =
    `Tipo de cambio global: ${formatDecimalInput(effectiveConfig?.usdToMxnRate ?? 0, 2)} · ` +
    `Vapi: ${effectiveConfig?.sources?.vapi === "campaign_override" ? "tarifa personalizada" : "tarifa global"} · ` +
    `Twilio: ${effectiveConfig?.sources?.twilio === "campaign_override" ? "tarifa personalizada" : "tarifa global"} · ` +
    `${total.usedRealVapiCostsCount} costos reales de Vapi y ${total.usedEstimatedVapiCostsCount} estimados.`;
}

function collectCampaignCostOverridePayload() {
  const enabled = $("costs_override_enabled").checked;
  return {
    costOverrideEnabled: enabled,
    overrideVapiCostPerMinuteUsd: enabled && $("costs_campaign_vapi_per_minute_usd").value !== ""
      ? Number($("costs_campaign_vapi_per_minute_usd").value)
      : null,
    overrideTwilioCostPerMinuteUsd: enabled && $("costs_campaign_twilio_per_minute_usd").value !== ""
      ? Number($("costs_campaign_twilio_per_minute_usd").value)
      : null,
  };
}

function validateCampaignCostOverridePayload(payload) {
  if (!payload.costOverrideEnabled) return "";
  if (payload.overrideVapiCostPerMinuteUsd !== null && (!Number.isFinite(payload.overrideVapiCostPerMinuteUsd) || payload.overrideVapiCostPerMinuteUsd < 0)) {
    return "Captura un costo Vapi por llamada valido para esta configuracion.";
  }
  if (payload.overrideTwilioCostPerMinuteUsd !== null && (!Number.isFinite(payload.overrideTwilioCostPerMinuteUsd) || payload.overrideTwilioCostPerMinuteUsd < 0)) {
    return "Captura una tarifa Twilio valida para esta configuracion.";
  }
  return "";
}

function renderCallsTable(columns = [], calls = []) {
  callsTableHeadEl.innerHTML = "";
  callsTableBodyEl.innerHTML = "";

  if (!selectedCampaign) {
    callsEmptyEl.textContent = "Selecciona una campaña para ver sus llamadas.";
    callsEmptyEl.hidden = false;
    return;
  }

  if (!calls.length) {
    callsEmptyEl.textContent = "Esta campaña todavía no tiene llamadas registradas.";
    callsEmptyEl.hidden = false;
    return;
  }

  callsEmptyEl.hidden = true;
  const headerRow = document.createElement("tr");
  columns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column.label;
    headerRow.appendChild(th);
  });
  callsTableHeadEl.appendChild(headerRow);

  calls.forEach((call) => {
    const row = document.createElement("tr");
    columns.forEach((column) => {
      const td = document.createElement("td");
      const value = call[column.key] ?? "";
      if (column.key === "transcript") {
        td.className = "cell-long";
        if (canOpenTranscript(value)) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "table-link-button";
          button.textContent = "Ver transcript";
          button.addEventListener("click", () => openTranscriptModal(value, call.phone));
          td.appendChild(button);
        } else {
          td.textContent = "Sin transcript";
        }
      } else if (column.key === "recordingUrl" && value) {
        td.className = "cell-long";
        const link = document.createElement("a");
        // Use proxy URL if it's a Twilio recording to avoid authentication prompt
        link.href = value.includes('twilio.com') ? getTwilioProxyUrl(value) : value;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Abrir recording";
        td.appendChild(link);
      } else {
        td.textContent = value;
      }
      row.appendChild(td);
    });
    callsTableBodyEl.appendChild(row);
  });
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
  const url = `${apiBase()}${path}`;
  console.log(`[Admin] ${method} ${url}`, body ? { payload: body } : '');
  try {
    const resp = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await resp.json().catch(() => ({}));
    console.log(`[Admin] ${method} ${path} → ${resp.status}`, data);
    if (!resp.ok) {
      throw new Error(data?.error || data?.message || `Error ${resp.status}`);
    }
    return data;
  } catch (error) {
    console.error(`[Admin] ${method} ${path} failed:`, error);
    // If fetch failed completely (network error, CORS, etc.)
    if (error.message === 'Failed to fetch') {
      throw new Error('Error de conexión. Verifica tu conexión a internet o revisa los logs del servidor.');
    }
    throw error;
  }
}

function hasLocalCampaignDraft() {
  return [
    "campaign_name",
    "campaign_id",
    "vapi_assistant_id",
    "vapi_phone_number_id",
    "ghl_location_id",
  ].some((id) => String($(id)?.value ?? "").trim());
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
      <label class="toggle-row"><input id="agent_active_${i}" type="checkbox" />Activo</label>
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
    ghlConnectedStageId: $("ghl_connected_stage_id").value.trim() || undefined,
    ghlOutcomeFieldId: $("ghl_outcome_field_id").value.trim() || undefined,
    ghlSellerTalkFieldId: $("ghl_seller_talk_field_id").value.trim() || undefined,
    ghlRecordingUrlFieldId: $("ghl_recording_url_field_id").value.trim() || undefined,
    active: $("campaign_active").checked,
  };

  // Only add ghlStageMapping if connectedStageId has a value
  const connectedStageId = $("ghl_connected_stage_id").value.trim();
  if (connectedStageId) {
    payload.ghlStageMapping = {
      transfer_success: connectedStageId,
      voicemail: connectedStageId,
    };
  }

  // Add call window configuration
  const callWindowMode = document.querySelector('input[name="call_window_mode"]:checked')?.value || "global";

  if (callWindowMode === "custom") {
    payload.callWindowEnabled = true;
    payload.callWindowTimezone = $("call_window_timezone").value.trim() || undefined;

    const startHour = $("call_window_start_hour").value.trim();
    if (startHour !== "") payload.callWindowStartHour = parseInt(startHour, 10);

    const endHour = $("call_window_end_hour").value.trim();
    if (endHour !== "") payload.callWindowEndHour = parseInt(endHour, 10);

    const selectedDays = [];
    for (let i = 0; i <= 6; i++) {
      if ($(`call_window_day_${i}`)?.checked) selectedDays.push(i);
    }
    if (selectedDays.length) payload.callWindowWeekdays = selectedDays.join(',');

    payload.callWindowApplyToFailover = true; // Always apply to failover
  } else if (callWindowMode === "disabled") {
    payload.callWindowEnabled = false;
  }
  // If mode is "global", don't send any call window fields (use DB null = global)

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
  isApplyingCampaign = true;
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
  $("ghl_connected_stage_id").value = campaign?.ghlConnectedStageId ?? "";
  // Use connectedStageId or fallback to stage mapping values
  const connectedStageId = campaign?.ghlConnectedStageId ?? campaign?.ghlStageMapping?.transfer_success ?? campaign?.ghlStageMapping?.voicemail ?? "";
  $("ghl_connected_stage_id").value = connectedStageId;
  $("ghl_outcome_field_id").value = campaign?.ghlOutcomeFieldId ?? "";
  $("ghl_seller_talk_field_id").value = campaign?.ghlSellerTalkFieldId ?? "";
  $("ghl_recording_url_field_id").value = campaign?.ghlRecordingUrlFieldId ?? "";
  $("campaign_active").checked = campaign?.active !== false;

  // Apply call window settings
  let callWindowMode = "global";
  if (campaign?.callWindowEnabled === false) {
    callWindowMode = "disabled";
  } else if (campaign?.callWindowEnabled === true) {
    callWindowMode = "custom";
  }
  document.getElementById(`call_window_mode_${callWindowMode}`)?.click();

  $("call_window_timezone").value = campaign?.callWindowTimezone ?? "America/Mexico_City";
  $("call_window_start_hour").value = campaign?.callWindowStartHour ?? "";
  $("call_window_end_hour").value = campaign?.callWindowEndHour ?? "";

  // Apply weekdays
  const weekdays = campaign?.callWindowWeekdays ? campaign.callWindowWeekdays.split(',').map(d => d.trim()) : [];
  for (let i = 0; i <= 6; i++) {
    const checkbox = $(`call_window_day_${i}`);
    if (checkbox) {
      checkbox.checked = weekdays.length === 0 || weekdays.includes(String(i));
    }
  }

  updateCallWindowFieldsVisibility();

  $("campaign_form_title").textContent = campaign ? "Editar campaña" : "Nueva campaña";
  $("campaign_mode_badge").textContent = campaign ? (campaign.active === false ? "Pausada" : "Editando") : "Creando";
  $("campaign_mode_badge").classList.toggle("is-editing", Boolean(campaign));
  $("btn_save_campaign").textContent = campaign ? "Guardar cambios" : "Crear campaña";
  updateCampaignActiveLabel();
  clearCampaignFieldErrors();
  clearAgentFieldErrors();
  setCampaignFeedback("");
  setAgentsFeedback(campaign ? `Editando agentes de ${campaign.name}.` : "Guarda o selecciona una campaña antes de capturar agentes.");
  setCallsFeedback(campaign ? `Cargando llamadas de ${campaign.name}...` : "Selecciona o crea una campaña para ver llamadas.");
  setCostsFeedback(campaign ? `Cargando costos de ${campaign.name}...` : "Selecciona o crea una campaña para ver costos.");
  applyCampaignCostOverride(campaign);
  renderCallsTable([], []);
  renderCostSummary(null);
  renderCampaignList();
  renderWebhookInstructions(campaign?.webhookInstructions ?? null);
  loadAgents().catch((error) => setStatus(error.message));
  loadCalls().catch((error) => {
    setCallsFeedback(error.message, "error");
    setStatus(error.message);
  });
  loadCosts().catch((error) => {
    setCostsFeedback(error.message, "error");
    setStatus(error.message);
  });
  campaignDraftDirty = false;
  isApplyingCampaign = false;
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
  if (campaignDraftDirty || (isCreatingCampaign && hasLocalCampaignDraft())) {
    setStatus("Campañas cargadas. Conservé el borrador que estás editando.");
    return;
  }
  if (current && !isCreatingCampaign) applyCampaign(current);
  if (!current && !hasLocalCampaignDraft()) applyCampaign(null);
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
  applyCampaign(data.campaign);
  await loadCampaigns();
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

  const seenGhlUserIds = new Set();
  for (const agent of agents) {
    if (seenGhlUserIds.has(agent.ghlUserId)) {
      return `Hay más de un agente con el mismo GHL User ID: ${agent.ghlUserId}.`;
    }
    seenGhlUserIds.add(agent.ghlUserId);
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
  console.log("[Admin] Saving agents:", { agents, fallback, campaign: selectedCampaign });
  const validationError = validateAgentPayload(agents, fallback);
  if (validationError) {
    setAgentsFeedback(validationError, "error");
    setStatus(validationError);
    return;
  }
  setStatus("Guardando agentes...");
  setAgentsFeedback(`Guardando agentes de ${selectedCampaign.name}...`);
  const response = await request("PUT", "/api/admin/ghl-agents", {
    propertyKey: selectedCampaign.propertyKey,
    campaignId: selectedCampaign.campaignId,
    agents,
    fallback,
  });
  console.log("[Admin] Agents saved response:", response);
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

async function loadCalls() {
  const token = ++callsLoadToken;
  const campaignAtRequest = selectedCampaign?.id ?? null;
  if (!selectedCampaignId || !selectedCampaign) {
    renderCallsSummary(null);
    renderCallsTable([], []);
    return;
  }
  setCallsFeedback(`Cargando llamadas de ${selectedCampaign.name}...`);
  setStatus("Cargando llamadas...");
  const data = await request("GET", `/api/admin/ghl-campaigns/${selectedCampaignId}/calls`);
  if (token !== callsLoadToken || campaignAtRequest !== selectedCampaign?.id) return;
  renderCallsSummary(data.summary ?? null);
  renderCallsTable(data.columns ?? [], data.calls ?? []);
  setCallsFeedback(`${data.count ?? 0} llamadas cargadas para ${selectedCampaign.name}.`);
  setStatus("Llamadas cargadas.");
}

async function loadCosts() {
  const token = ++costsLoadToken;
  const campaignAtRequest = selectedCampaign?.id ?? null;

  if (!selectedCampaignId || !selectedCampaign) {
    if (token !== costsLoadToken) return;
    applyCampaignCostOverride(null);
    renderCostSummary(null);
    setCostsFeedback("Selecciona o crea una campaña para ver costos.");
    return;
  }

  setCostsFeedback(`Cargando costos de ${selectedCampaign.name}...`);
  const summaryData = await request("GET", `/api/admin/ghl-campaigns/${selectedCampaignId}/costs`);
  if (token !== costsLoadToken || campaignAtRequest !== selectedCampaign?.id) return;

  applyCampaignCostOverride(selectedCampaign);
  renderCostSummary(summaryData);
  setCostsFeedback(`Costos cargados para ${selectedCampaign.name}.`);
}

async function saveCampaignCostOverride() {
  if (!selectedCampaignId || !selectedCampaign) {
    setCostsFeedback("Selecciona una campaña antes de guardar esta configuración.", "error");
    setStatus("Selecciona una campaña antes de guardar esta configuración.");
    return;
  }
  const payload = collectCampaignCostOverridePayload();
  const validationError = validateCampaignCostOverridePayload(payload);
  if (validationError) {
    setCostsFeedback(validationError, "error");
    setStatus(validationError);
    return;
  }
  setCostsFeedback(`Guardando configuración de costos para ${selectedCampaign.name}...`);
  setStatus("Guardando configuración de costos...");
  const data = await request("PUT", `/api/admin/ghl-campaigns/${selectedCampaignId}/cost-config`, payload);
  selectedCampaign = data.campaign;
  applyCampaignCostOverride(selectedCampaign);
  await loadCampaigns();
  await loadCosts();
  setCostsFeedback(`Configuración de costos guardada para ${selectedCampaign.name}.`);
  setStatus("Configuración de costos guardada.");
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
$("btn_save_campaign").addEventListener("click", () => saveCampaign().catch((error) => {
  setCampaignFeedback(error.message, "error");
  setStatus(error.message);
}));
$("campaign_active").addEventListener("change", updateCampaignActiveLabel);
$("btn_save_agents").addEventListener("click", () => saveAgents().catch((error) => setStatus(error.message)));
$("btn_test_call")?.addEventListener("click", () => runTestCall().catch((error) => setStatus(error.message)));
$("btn_refresh_calls").addEventListener("click", () => loadCalls().catch((error) => {
  setCallsFeedback(error.message, "error");
  setStatus(error.message);
}));
$("btn_refresh_costs")?.addEventListener("click", () => loadCosts().catch((error) => {
  setCostsFeedback(error.message, "error");
  setStatus(error.message);
}));
$("btn_download_calls_csv").addEventListener("click", () => downloadCallsCsv().catch((error) => {
  setCallsFeedback(error.message, "error");
  setStatus(error.message);
}));
$("btn_save_costs_campaign")?.addEventListener("click", () => saveCampaignCostOverride().catch((error) => {
  setCostsFeedback(error.message, "error");
  setStatus(error.message);
}));
$("costs_override_enabled")?.addEventListener("change", updateCampaignCostOverrideInputs);
$("btn_close_transcript_modal")?.addEventListener("click", closeTranscriptModal);
$("transcript_modal")?.addEventListener("click", (event) => {
  if (event.target === transcriptModalEl) closeTranscriptModal();
});
$("btn_copy_handoff").addEventListener("click", async () => {
  await navigator.clipboard.writeText(handoffText());
  setStatus("Instrucciones copiadas.");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && transcriptModalEl && !transcriptModalEl.hidden) {
    closeTranscriptModal();
  }
});

// Call window mode change
document.querySelectorAll('input[name="call_window_mode"]').forEach((radio) => {
  radio.addEventListener("change", updateCallWindowFieldsVisibility);
});

emptyAgentRows();
updateCallWindowFieldsVisibility();
loadCampaigns().catch((error) => setStatus(error.message));
