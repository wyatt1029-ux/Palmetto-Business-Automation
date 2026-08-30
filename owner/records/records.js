const endpoint = "/owner/api/records";
const shell = document.querySelector("[data-records-view]");
const view = shell?.dataset.recordsView || "clients";
const body = document.querySelector("#records-body");
const count = document.querySelector("#record-count");
const error = document.querySelector("#records-error");
const search = document.querySelector("#records-search");
let records = [];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
}[character]));

const label = (value) => String(value || "Not started")
  .replaceAll("_", " ")
  .replace(/\b\w/g, (character) => character.toUpperCase());

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
};

const formatMoney = (amount) => typeof amount === "number"
  ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount / 100)
  : "—";

const matches = (record, term) => !term || [
  record.organization, record.full_name, record.customer_number, record.email,
  record.sow_title, record.title, record.payment_status, record.billing_status,
].some((value) => String(value || "").toLowerCase().includes(term));

const statusPill = (status) => {
  const warning = ["failed", "past_due", "changes_requested"].includes(status);
  const positive = ["approved", "paid", "active"].includes(status);
  return `<span class="pill${warning ? " pill-red" : positive ? "" : " pill-amber"}">${escapeHtml(label(status))}</span>`;
};

const leadLink = (record) => record.lead_id
  ? `<a class="record-link" href="/owner/leads/?lead=${encodeURIComponent(record.lead_id)}">${escapeHtml(record.organization || record.full_name)}</a>`
  : `<strong>${escapeHtml(record.organization || record.full_name)}</strong>`;

const clientRow = (record) => `<tr>
  <td>${leadLink(record)}<small>${escapeHtml(record.customer_number)}</small></td>
  <td>${record.sow_id ? `<a class="record-link" href="/sow-builder.html?intake=${encodeURIComponent(record.id)}">${escapeHtml(record.sow_title || "Open SOW")}</a><small>Version ${escapeHtml(record.sow_version)}</small>` : `<a class="record-link" href="/sow-builder.html?intake=${encodeURIComponent(record.id)}">Create SOW</a>`}</td>
  <td>${statusPill(record.sow_status || record.status)}</td>
  <td>${formatMoney(record.amount_cents)}</td>
  <td>${escapeHtml(formatDate(record.updated_at))}</td>
</tr>`;

const paymentRow = (record) => `<tr>
  <td>${leadLink(record)}<small>${escapeHtml(record.customer_number)}</small></td>
  <td><a class="record-link" href="/sow-builder.html?intake=${encodeURIComponent(record.intake_submission_id)}">${escapeHtml(record.title)}</a><small>${escapeHtml(label(record.billing_type))}</small></td>
  <td>${formatMoney(record.amount_cents)}</td>
  <td>${statusPill(record.payment_status)}</td>
  <td>${statusPill(record.billing_status)}</td>
  <td>${escapeHtml(formatDate(record.updated_at))}</td>
</tr>`;

const render = () => {
  const term = String(search?.value || "").trim().toLowerCase();
  const visible = records.filter((record) => matches(record, term));
  count.textContent = `${visible.length} ${visible.length === 1 ? "record" : "records"}`;
  body.innerHTML = visible.length
    ? visible.map(view === "payments" ? paymentRow : clientRow).join("")
    : `<tr><td class="empty-state" colspan="${view === "payments" ? 6 : 5}">${term ? "No matching records." : view === "payments" ? "No payment records yet." : "No client or project records yet."}</td></tr>`;
};

const load = async () => {
  try {
    const response = await fetch(`${endpoint}?view=${encodeURIComponent(view)}`, { headers: { accept: "application/json" } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Unable to load owner records.");
    records = Array.isArray(result.records) ? result.records : [];
    render();
  } catch (cause) {
    error.hidden = false;
    error.textContent = cause.message;
    count.textContent = "Unavailable";
    body.innerHTML = `<tr><td class="empty-state" colspan="${view === "payments" ? 6 : 5}">Owner records could not be loaded.</td></tr>`;
  }
};

search?.addEventListener("input", render);
load();
