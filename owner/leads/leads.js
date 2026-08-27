(() => {
  const LEADS_API = "/owner/api/leads";
  const state = { view: "queue", leads: [], selected: null };
  const demoLeads = [
    { id: "demo-1", businessName: "Lowcountry HVAC Demo", city: "Charleston", serviceArea: "Charleston", industry: "Home services", source: "new_business_radar", stage: "new", fitLevel: "high", fitReasons: ["No clear service-request form"], nextAction: "Review contact path", nextActionDue: "2026-08-28", nextActionOwner: "Owner", nextActionCompleted: false, contactStatus: "not_contacted", tidalConflictReviewStatus: "not_needed", archived: false, launchSignals: ["New LLC filing"], dateConfidence: "confirmed", discoveredDate: "2026-08-20", lastVerifiedDate: "2026-08-25", createdAt: "2026-08-20", servicesInterest: ["landing page"] },
    { id: "demo-2", businessName: "Harbor Route Marine Demo", city: "Mount Pleasant", serviceArea: "Charleston", industry: "Marine service", source: "researched", stage: "contacted", fitLevel: "medium", fitReasons: ["Website has phone only; no lead workflow"], nextAction: "Complete conflict review", nextActionDue: "2026-08-27", nextActionOwner: "Owner", nextActionCompleted: false, contactStatus: "not_contacted", tidalConflictReviewStatus: "pending", archived: false, launchSignals: ["New website"], dateConfidence: "unknown", discoveredDate: "2026-08-18", lastVerifiedDate: "2026-08-24", createdAt: "2026-08-18", servicesInterest: ["workflow"] },
    { id: "demo-3", businessName: "Palmetto Bookkeeping Demo", city: "Myrtle Beach", serviceArea: "Grand Strand", industry: "Professional services", source: "website_inquiry", stage: "discovery_scheduled", fitLevel: "high", fitReasons: ["Payment or intake workflow may be fragmented"], nextAction: "Prepare discovery notes", nextActionDue: "2026-09-02", nextActionOwner: "Owner", nextActionCompleted: false, contactStatus: "replied", tidalConflictReviewStatus: "not_needed", archived: false, launchSignals: ["Now open social post"], dateConfidence: "estimated", discoveredDate: "2026-08-15", lastVerifiedDate: "2026-08-23", createdAt: "2026-08-15", servicesInterest: ["website", "workflow"] },
  ];
  const $ = (selector) => document.querySelector(selector);
  const api = async (url, options = {}) => {
    const response = await fetch(url, { headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}) }, ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(body.error || "Unable to load the private workspace."); error.status = response.status; error.body = body; throw error; }
    return body;
  };
  const date = (value) => value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : "—";
  const stageLabel = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).replace("Paid Active", "Paid / Active");
  const isOverdue = (lead) => lead.nextActionDue && !lead.nextActionCompleted && lead.nextActionDue < new Date().toISOString().slice(0, 10);
  const conflict = (lead) => lead.tidalConflictReviewStatus === "pending" ? `<span class="pill pill-amber">Pending review</span>` : `<span class="pill">${stageLabel(lead.tidalConflictReviewStatus || "Not needed")}</span>`;
  const fitReason = (lead) => lead.fitReasons?.[0] || "Fit reason not recorded";

  function renderRows() {
    const tbody = $("#lead-rows");
    $("#record-count").textContent = `${state.leads.length} record${state.leads.length === 1 ? "" : "s"}`;
    if (!state.leads.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No private leads match this view yet.</td></tr>'; return; }
    tbody.innerHTML = state.leads.map((lead) => `<tr tabindex="0" data-lead-id="${lead.id}"><td><a class="business-link" href="#" data-open-lead="${lead.id}">${escapeHtml(lead.businessName)}</a><small>${escapeHtml(lead.city || lead.serviceArea || "City not recorded")}</small></td><td class="why-fit">${escapeHtml(fitReason(lead))}</td><td class="next-action">${escapeHtml(lead.nextAction || "Set a next action")}</td><td class="${isOverdue(lead) ? "due-overdue" : ""}">${isOverdue(lead) ? "Overdue · " : ""}${date(lead.nextActionDue)}</td><td><span class="pill">${stageLabel(lead.stage)}</span></td><td>${conflict(lead)}</td></tr>`).join("");
    tbody.querySelectorAll("[data-open-lead]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); openDetail(link.dataset.openLead); }));
    tbody.querySelectorAll("tr[data-lead-id]").forEach((row) => row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDetail(row.dataset.leadId); } }));
  }
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));

  async function load() {
    if (location.hostname === "127.0.0.1" && new URLSearchParams(location.search).get("demo") === "1") {
      state.leads = demoLeads.filter((lead) => state.view === "pipeline" || state.view === "all" || state.view === "queue" ? !lead.archived : state.view === "radar" ? lead.contactStatus === "not_contacted" && lead.tidalConflictReviewStatus !== "pending" : true);
      $("#needs-action-count").textContent = "3"; $("#new-review-count").textContent = "1"; $("#conflict-count").textContent = "1"; renderRows(); renderPipeline(state.leads); return;
    }
    const params = new URLSearchParams({ view: state.view });
    new FormData($("#filters-form")).forEach((value, key) => { if (key === "overdue" || value) params.set(key, value === "on" ? "true" : value); });
    const body = await api(`${LEADS_API}?${params}`);
    state.leads = body.leads || [];
    $("#needs-action-count").textContent = body.counts?.needsAction ?? "0";
    $("#new-review-count").textContent = body.counts?.newToReview ?? "0";
    $("#conflict-count").textContent = body.counts?.conflictReviews ?? "0";
    renderRows();
    renderPipeline(body.leads || []);
  }
  function renderPipeline(leads) {
    $("#pipeline-strip").hidden = state.view !== "pipeline";
    $("#list-title").textContent = state.view === "radar" ? "New Business Radar" : state.view === "all" ? "All Leads" : state.view === "pipeline" ? "Pipeline Leads" : "Today & Next Up";
    const stages = ["new", "contacted", "discovery_scheduled", "qualified", "scope_sent", "approved", "paid_active"];
    $("#pipeline-stages").innerHTML = stages.map((stage) => `<button class="pipeline-stage" type="button" data-pipeline-stage="${stage}"><strong>${leads.filter((lead) => lead.stage === stage).length}</strong><span>${stageLabel(stage)}</span></button>`).join("");
    $("#pipeline-stages").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { $("#stage-filter").value = button.dataset.pipelineStage; load(); }));
  }
  async function openDetail(id) {
    try {
      const demoMode = location.hostname === "127.0.0.1" && new URLSearchParams(location.search).get("demo") === "1";
      const body = demoMode ? { lead: demoLeads.find((item) => item.id === id), activities: [{ activity_type: "research_added", note: "Research added from a public source; verify before outreach.", owner_email: "demo owner", created_at: "2099-01-25" }, { activity_type: "internal_note", note: "Keep the next step specific and reversible.", owner_email: "demo owner", created_at: "2099-01-26" }] } : await api(`${LEADS_API}?id=${encodeURIComponent(id)}&view=all`); state.selected = body;
      const lead = body.lead; $("#detail-title").textContent = lead.businessName;
      $("#detail-content").innerHTML = `<div class="detail-top"><span class="pill">${stageLabel(lead.stage)}</span><span class="pill">${stageLabel(lead.fitLevel)} fit</span>${conflict(lead)}</div><div class="detail-actions"><button class="button button-secondary" data-detail-action="complete">Complete next action</button><button class="button button-secondary" data-detail-action="contact">Mark do not contact</button><button class="button button-secondary" data-detail-action="archive">Archive lead</button></div><div class="detail-next"><h3>Next action</h3><p><strong>${escapeHtml(lead.nextAction || "No next action set")}</strong> · ${date(lead.nextActionDue)} · ${escapeHtml(lead.nextActionOwner || "Owner")}</p></div><div class="detail-sections"><article class="detail-card"><h3>Overview</h3><dl><dt>City / area</dt><dd>${escapeHtml(lead.city || "—")} / ${escapeHtml(lead.serviceArea || "—")}</dd><dt>Industry</dt><dd>${escapeHtml(lead.industry || "—")}</dd><dt>Website</dt><dd>${lead.websiteUrl ? `<a class="business-link" href="${escapeHtml(lead.websiteUrl)}" target="_blank" rel="noreferrer">${escapeHtml(lead.normalizedDomain)}</a>` : "—"}</dd><dt>Source</dt><dd>${escapeHtml(stageLabel(lead.source))}</dd><dt>Created</dt><dd>${date(lead.createdAt)}</dd></dl></article><article class="detail-card"><h3>Research</h3><dl><dt>Formation date</dt><dd>${date(lead.formationDate)} (${escapeHtml(stageLabel(lead.dateConfidence))})</dd><dt>Opened date</dt><dd>${date(lead.openedDate)}</dd><dt>Launch signals</dt><dd>${escapeHtml((lead.launchSignals || []).join(", ") || "—")}</dd><dt>Last verified</dt><dd>${date(lead.lastVerifiedDate)}</dd><dt>Fit reasons</dt><dd>${escapeHtml((lead.fitReasons || []).join(", ") || "—")}</dd></dl></article><article class="detail-card span-two"><h3>Activity timeline</h3><ol class="activity-list">${(body.activities || []).map((item) => `<li><small>${date(item.created_at)} · ${escapeHtml(item.owner_email)}</small><strong>${escapeHtml(stageLabel(item.activity_type))}</strong><div>${escapeHtml(item.note)}</div></li>`).join("") || "<li>No activity recorded yet.</li>"}</ol><form id="activity-form" class="dialog-actions"><input name="note" required placeholder="Add an internal note" aria-label="Activity note" /><select name="activityType" aria-label="Activity type"><option value="internal_note">Internal note</option><option value="call_attempted">Call attempted</option><option value="email_drafted">Email drafted</option><option value="discovery_scheduled">Discovery scheduled</option></select><button class="button button-primary">Add Activity</button></form></article></div>`;
      $("#detail-dialog").showModal();
      $("#activity-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); await api(LEADS_API, { method: "PUT", body: JSON.stringify({ action: "activity", id, note: form.get("note"), activityType: form.get("activityType") }) }); await openDetail(id); });
      $("#detail-content").querySelectorAll("[data-detail-action]").forEach((button) => button.addEventListener("click", async () => { const action = button.dataset.detailAction; const data = { id, action }; if (action === "complete") data.nextActionCompleted = true; if (action === "contact") { data.doNotContact = true; data.contactStatus = "do_not_contact"; } if (action === "archive") { data.archived = true; data.stage = "archived"; } await api(LEADS_API, { method: "PUT", body: JSON.stringify(data) }); $("#detail-dialog").close(); await load(); }));
    } catch (error) { alert(error.message); }
  }
  function openAdd() { $("#lead-form").reset(); $("#lead-form-error").textContent = ""; $("#dialog-title").textContent = "Add Lead"; $("#lead-dialog").showModal(); }
  $("#add-lead-button").addEventListener("click", openAdd);
  $("#close-detail").addEventListener("click", () => $("#detail-dialog").close());
  $("#filters-form").addEventListener("input", () => load().catch((error) => alert(error.message)));
  document.querySelectorAll(".view-tab").forEach((button) => button.addEventListener("click", () => { state.view = button.dataset.view; document.querySelectorAll(".view-tab").forEach((item) => item.classList.toggle("active", item === button)); load().catch((error) => alert(error.message)); }));
  document.querySelectorAll("[data-summary]").forEach((button) => button.addEventListener("click", () => { const key = button.dataset.summary; state.view = "all"; document.querySelectorAll(".view-tab").forEach((item) => item.classList.toggle("active", item.dataset.view === "all")); if (key === "conflictReviews") $("#fit-filter").value = ""; if (key === "newToReview") $("#stage-filter").value = "new"; if (key === "needsAction") $("#overdue-filter").checked = false; load().catch((error) => alert(error.message)); }));
  $("#lead-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const data = Object.fromEntries(form.entries()); data.fitReasons = data.fitReasons ? data.fitReasons.split(",") : []; try { await api(LEADS_API, { method: "POST", body: JSON.stringify(data) }); $("#lead-dialog").close(); await load(); } catch (error) { if (error.status === 409 && error.body?.duplicates?.length && window.confirm(`${error.message}\n\n${error.body.duplicates.map((lead) => lead.business_name).join(", ")}\n\nSave this as a separate record after review?`)) { try { data.confirmDuplicate = true; await api(LEADS_API, { method: "POST", body: JSON.stringify(data) }); $("#lead-dialog").close(); await load(); return; } catch (retryError) { error = retryError; } } $("#lead-form-error").textContent = error.message; } });
  load().catch((error) => { $("#lead-rows").innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(error.message)}</td></tr>`; });
})();
