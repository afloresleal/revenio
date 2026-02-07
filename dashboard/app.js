const API_BASE = "http://localhost:3000";
const PAGE_SIZE = 100;

const refreshBtn = document.getElementById("refreshBtn");
const lastUpdated = document.getElementById("lastUpdated");
const errorMsg = document.getElementById("errorMsg");
const searchInput = document.getElementById("searchInput");

const totalLeads = document.getElementById("totalLeads");
const newLeads = document.getElementById("newLeads");
const withAttempts = document.getElementById("withAttempts");
const last24h = document.getElementById("last24h");

const leadsTbody = document.getElementById("leadsTbody");

let cachedLeads = [];

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function setError(message) {
  errorMsg.textContent = message || "";
}

async function fetchAllLeads() {
  const first = await fetch(`${API_BASE}/leads?page=1&pageSize=${PAGE_SIZE}`);
  if (!first.ok) {
    throw new Error(`API error: ${first.status}`);
  }
  const firstData = await first.json();
  const totalPages = firstData.totalPages || 1;
  let all = firstData.data || [];

  for (let page = 2; page <= totalPages; page += 1) {
    const resp = await fetch(`${API_BASE}/leads?page=${page}&pageSize=${PAGE_SIZE}`);
    if (!resp.ok) {
      throw new Error(`API error: ${resp.status}`);
    }
    const data = await resp.json();
    all = all.concat(data.data || []);
  }

  return { total: firstData.total || all.length, leads: all };
}

function renderMetrics(leads, totalCount) {
  totalLeads.textContent = totalCount;
  newLeads.textContent = leads.filter((l) => l.status === "NEW").length;
  withAttempts.textContent = leads.filter((l) => (l._count?.attempts ?? 0) > 0).length;

  const now = Date.now();
  const recent = leads.filter((l) => {
    const created = new Date(l.createdAt).getTime();
    return !Number.isNaN(created) && now - created <= 24 * 60 * 60 * 1000;
  }).length;
  last24h.textContent = recent;
}

function renderTable(leads) {
  if (!leads.length) {
    leadsTbody.innerHTML = '<tr><td colspan="5" class="muted">Sin datos</td></tr>';
    return;
  }

  leadsTbody.innerHTML = leads
    .map((lead) => {
      const attempts = lead._count?.attempts ?? 0;
      const name = lead.name || "—";
      const phone = lead.phone || "—";
      const status = lead.status || "—";
      return `
        <tr>
          <td>${formatDate(lead.createdAt)}</td>
          <td>${name}</td>
          <td>${phone}</td>
          <td><span class="status">${status}</span></td>
          <td>${attempts}</td>
        </tr>
      `;
    })
    .join("");
}

function applySearch(leads, term) {
  if (!term) return leads;
  const t = term.toLowerCase();
  return leads.filter((lead) => {
    const name = (lead.name || "").toLowerCase();
    const phone = (lead.phone || "").toLowerCase();
    return name.includes(t) || phone.includes(t);
  });
}

async function load() {
  setError("");
  leadsTbody.innerHTML = '<tr><td colspan="5" class="muted">Cargando...</td></tr>';
  try {
    const { total, leads } = await fetchAllLeads();
    cachedLeads = leads;
    renderMetrics(leads, total);
    renderTable(leads);
    lastUpdated.textContent = `Última actualización: ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    setError("No se pudo cargar el API. Verifica que esté en http://localhost:3000.");
    leadsTbody.innerHTML = '<tr><td colspan="5" class="muted">Error de carga</td></tr>';
  }
}

refreshBtn.addEventListener("click", load);
searchInput.addEventListener("input", (e) => {
  const filtered = applySearch(cachedLeads, e.target.value);
  renderTable(filtered);
});

load();
