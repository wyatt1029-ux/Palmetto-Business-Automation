(() => {
  const LEADS_API = "/owner/api/leads";
  const DISCOVERY_API = "/owner/api/discovery";
  const LIST_FIELDS = ["sourceUrls", "publicSocialLinks", "fitReasons", "servicesInterest", "launchSignals"];
  const BOOLEAN_FIELDS = ["nextActionCompleted", "tidalConflictReviewRequired", "doNotContact", "archived"];
  const pipelineStages = ["new", "contacted", "discovery_scheduled", "qualified", "scope_sent", "approved", "paid_active"];
  const state = {
    view: "queue",
    leads: [],
    selected: null,
    pipelineCounts: {},
    discoveryCandidates: [],
    pendingLeadId: new URLSearchParams(location.search).get("lead"),
    emailDraftLeadId: null,
    emailDraftLogged: false,
  };
  const demoLeads = [
    { id: "demo-1", businessName: "Lowcountry HVAC Demo", city: "Charleston", serviceArea: "Charleston", industry: "Home services", source: "new_business_radar", stage: "new", fitLevel: "high", fitReasons: ["No clear service-request form"], nextAction: "Review contact path", nextActionDue: "2026-08-28", nextActionOwner: "Owner", nextActionCompleted: false, contactStatus: "not_contacted", tidalConflictReviewStatus: "not_needed", archived: false, launchSignals: ["New LLC filing"], dateConfidence: "confirmed", discoveredDate: "2026-08-20", lastVerifiedDate: "2026-08-25", createdAt: "2026-08-20", servicesInterest: ["landing page"], sourceUrls: [], publicSocialLinks: [] },
    { id: "demo-2", businessName: "Harbor Route Marine Demo", city: "Mount Pleasant", serviceArea: "Charleston", industry: "Marine service", source: "researched", stage: "contacted", fitLevel: "medium", fitReasons: ["Website has phone only; no lead workflow"], nextAction: "Complete conflict review", nextActionDue: "2026-08-27", nextActionOwner: "Owner", nextActionCompleted: false, contactStatus: "not_contacted", tidalConflictReviewRequired: true, tidalConflictReviewStatus: "pending", archived: false, launchSignals: ["New website"], dateConfidence: "unknown", discoveredDate: "2026-08-18", lastVerifiedDate: "2026-08-24", createdAt: "2026-08-18", servicesInterest: ["workflow"], sourceUrls: [], publicSocialLinks: [] },
    { id: "demo-3", businessName: "Palmetto Bookkeeping Demo", city: "Myrtle Beach", serviceArea: "Grand Strand", industry: "Professional services", source: "website_inquiry", stage: "discovery_scheduled", fitLevel: "high", fitReasons: ["Payment or intake workflow may be fragmented"], nextAction: "Prepare discovery notes", nextActionDue: "2026-09-02", nextActionOwner: "Owner", nextActionCompleted: false, contactStatus: "replied", tidalConflictReviewStatus: "not_needed", archived: false, launchSignals: ["Now open social post"], dateConfidence: "estimated", discoveredDate: "2026-08-15", lastVerifiedDate: "2026-08-23", createdAt: "2026-08-15", servicesInterest: ["website", "workflow"], sourceUrls: [], publicSocialLinks: [] },
  ];
  const demoDiscoveryCandidates = [
    { id: "discovery-demo-1", businessName: "Lowcountry Service Company Demo", websiteUrl: "https://example.com", normalizedDomain: "example.com", city: "843 area code", serviceArea: "843 area code", industry: "Home services", sourceUrls: ["https://example.com"], fitLevel: "high", fitReasons: ["Website appears to rely on phone contact", "No online booking link found", "Mobile viewport setup was not found"], servicesInterest: ["website", "lead workflow"], launchSignals: ["Now open announcement"], dateConfidence: "unknown", publicPhone: null, publicEmail: null, publicContactFormUrl: null, lastVerifiedDate: "2026-08-27", tidalConflictReviewRequired: false, tidalConflictReviewStatus: "not_needed", checks: { hasViewport: false, hasForm: false, hasPhone: true, hasBooking: false, usesHttps: true, hasSecureAssets: true, hasModernMarkup: true, hasFlexibleLayout: true } },
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const stageLabel = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).replace("Paid Active", "Paid / Active");
  const formatDate = (value) => {
    if (!value) return "—";
    const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    return Number.isNaN(parsed.valueOf()) ? "—" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(parsed);
  };
  const formatMoney = (cents, currency = "usd") => new Intl.NumberFormat(undefined, { style: "currency", currency: String(currency || "usd").toUpperCase() }).format(Number(cents || 0) / 100);
  const isOverdue = (lead) => lead.nextActionDue && !lead.nextActionCompleted && lead.nextActionDue < new Date().toISOString().slice(0, 10);
  const isDemo = () => location.hostname === "127.0.0.1" && new URLSearchParams(location.search).get("demo") === "1";
  const conflict = (lead) => lead.tidalConflictReviewStatus === "pending"
    ? '<span class="pill pill-amber">Pending review</span>'
    : `<span class="pill">${escapeHtml(stageLabel(lead.tidalConflictReviewStatus || "not_needed"))}</span>`;
  const fitReason = (lead) => lead.fitReasons?.[0] || "Fit reason not recorded";

  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}) },
      ...options,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || "Unable to load the private workspace.");
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  };

  const showWorkspaceError = (message = "") => {
    const element = $("#workspace-error");
    element.textContent = message;
    element.hidden = !message;
  };

  const showDiscoveryError = (message = "") => {
    const element = $("#discovery-error");
    element.textContent = message;
    element.hidden = !message;
  };

  const discoveryChecks = (checks = {}) => [
    ["Responsive viewport", checks.hasViewport],
    ["HTTPS", checks.usesHttps],
    ["Secure page assets", checks.hasSecureAssets],
    ["Modern page structure", checks.hasModernMarkup],
    ["Flexible layout", checks.hasFlexibleLayout],
    ["Request form", checks.hasForm],
    ["Phone link", checks.hasPhone],
    ["Contact path", checks.hasContactLink],
    ["Online booking", checks.hasBooking],
    ["Payment link", checks.hasPayment],
  ].map(([label, found]) => `<span class="check-result ${found ? "check-found" : "check-missing"}">${found ? "Found" : "Not found"}: ${escapeHtml(label)}</span>`).join("");

  function renderDiscoveryResults(meta = {}) {
    const container = $("#discovery-results");
    const candidates = state.discoveryCandidates;
    if (!candidates.length) {
      container.innerHTML = meta.searched ? '<div class="discovery-empty">No reviewable business websites were found in this bounded search. Try a broader area or different business types.</div>' : "";
      return;
    }
    container.innerHTML = candidates.map((candidate) => `
      <article class="discovery-card" data-candidate-id="${escapeHtml(candidate.id)}">
        <div class="discovery-card-heading"><div><span class="pill">${escapeHtml(stageLabel(candidate.fitLevel))} fit</span>${candidate.tidalConflictReviewRequired ? '<span class="pill pill-amber">Tidal review required</span>' : ""}<h3>${escapeHtml(candidate.businessName)}</h3><p>${escapeHtml(candidate.normalizedDomain || candidate.city || "Public web result")}</p></div><button class="button button-primary" type="button" data-add-candidate="${escapeHtml(candidate.id)}">Add to Radar</button></div>
        <p>Checked directly from this business website on ${escapeHtml(formatDate(candidate.lastVerifiedDate))}. Search-provider results are temporary and are not saved to the CRM.</p>
        ${candidate.locationEvidence ? `<p><strong>Local match:</strong> ${escapeHtml(candidate.locationEvidence)}</p>` : ""}
        <div class="candidate-links"><a href="${escapeHtml(candidate.websiteUrl)}" target="_blank" rel="noreferrer">Open website</a>${(candidate.sourceUrls || []).map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open source</a>`).join("")}</div>
        <h4>Observed opportunities</h4><ul>${(candidate.fitReasons || []).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>
        ${candidate.launchSignals?.length ? `<p><strong>Launch signals:</strong> ${escapeHtml(candidate.launchSignals.join(", "))}</p>` : '<p class="muted"><strong>Launch date:</strong> Unknown; verify before treating this as a newly opened business.</p>'}
        <div class="candidate-checks" aria-label="Automated website checks">${discoveryChecks(candidate.checks)}</div>
        <p class="candidate-message" aria-live="polite"></p>
      </article>`).join("");
    $$('[data-add-candidate]', container).forEach((button) => button.addEventListener("click", () => addCandidateToRadar(button.dataset.addCandidate)));
  }

  const candidatePayload = (candidate) => {
    const due = new Date();
    due.setDate(due.getDate() + 2);
    return {
      businessName: candidate.businessName,
      websiteUrl: candidate.websiteUrl,
      city: candidate.city || "",
      serviceArea: candidate.serviceArea || "",
      industry: candidate.industry || "",
      source: "new_business_radar",
      sourceUrls: candidate.sourceUrls || [],
      publicPhone: candidate.publicPhone || "",
      publicEmail: candidate.publicEmail || "",
      publicContactFormUrl: candidate.publicContactFormUrl || "",
      publicSocialLinks: [],
      stage: "new",
      fitLevel: candidate.fitLevel || "medium",
      fitReasons: candidate.fitReasons || [],
      servicesInterest: candidate.servicesInterest || [],
      formationDate: "",
      openedDate: "",
      dateConfidence: "unknown",
      discoveredDate: new Date().toISOString().slice(0, 10),
      launchSignals: candidate.launchSignals || [],
      nextAction: candidate.tidalConflictReviewRequired ? "Complete Tidal conflict review" : "Review public sources and confirm fit",
      nextActionDue: due.toISOString().slice(0, 10),
      nextActionOwner: "Owner",
      nextActionCompleted: false,
      lastVerifiedDate: candidate.lastVerifiedDate || new Date().toISOString().slice(0, 10),
      contactStatus: "not_contacted",
      doNotContact: false,
      doNotContactReason: "",
      internalNotes: `Discovered through an owner-triggered search. Saved details were independently checked against the business's public website.${candidate.locationEvidence ? ` Local match: ${candidate.locationEvidence}.` : ""} Verify all details before outreach.`,
      archived: false,
      tidalConflictReviewRequired: Boolean(candidate.tidalConflictReviewRequired),
      tidalConflictReviewStatus: candidate.tidalConflictReviewRequired ? "pending" : "not_needed",
      tidalConflictNotes: candidate.tidalConflictReviewRequired ? "Public search matched a marine-related term. Owner review required before outreach." : "",
    };
  };

  async function addCandidateToRadar(id) {
    const candidate = state.discoveryCandidates.find((item) => item.id === id);
    if (!candidate) return;
    const card = $(`[data-candidate-id="${CSS.escape(id)}"]`);
    const button = $("[data-add-candidate]", card);
    const message = $(".candidate-message", card);
    button.disabled = true;
    message.textContent = "Adding to the private workspace…";
    try {
      if (!isDemo()) await api(LEADS_API, { method: "POST", body: JSON.stringify(candidatePayload(candidate)) });
      button.textContent = "Added";
      message.textContent = candidate.tidalConflictReviewRequired
        ? "Added with a pending Tidal conflict review. It is not ready for outreach."
        : "Added to New Business Radar with a next review action.";
      await load();
    } catch (error) {
      button.disabled = false;
      message.textContent = error.status === 409 ? "A possible duplicate already exists. Review All Leads before adding another record." : error.message;
    }
  }

  async function runDiscovery(event) {
    event.preventDefault();
    const button = $("#run-discovery");
    const status = $("#discovery-status");
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    payload.businessTypes = String(payload.businessTypes || "").split(",").map((item) => item.trim()).filter(Boolean);
    payload.maxResults = Number(payload.maxResults);
    button.disabled = true;
    showDiscoveryError();
    status.textContent = "Searching public sources and checking business websites. This can take a few moments…";
    $("#discovery-results").innerHTML = "";
    try {
      const body = isDemo()
        ? { provider: "Sanitized local demo", candidates: demoDiscoveryCandidates, coverage: "One sanitized demonstration result." }
        : await api(DISCOVERY_API, { method: "POST", body: JSON.stringify(payload) });
      state.discoveryCandidates = body.candidates || [];
      status.textContent = `${state.discoveryCandidates.length} candidate${state.discoveryCandidates.length === 1 ? "" : "s"} ready for review. ${body.coverage || ""}`;
      renderDiscoveryResults({ searched: true });
    } catch (error) {
      state.discoveryCandidates = [];
      status.textContent = "";
      showDiscoveryError(error.message);
      renderDiscoveryResults({ searched: true });
    } finally {
      button.disabled = false;
    }
  }

  function runQuickDiscovery(button) {
    const form = $("#discovery-form");
    form.elements.location.value = button.dataset.discoveryLocation || form.elements.location.value;
    form.elements.businessTypes.value = button.dataset.discoveryTypes || "";
    form.elements.focus.value = button.dataset.discoveryFocus || form.elements.focus.value;
    form.requestSubmit();
  }

  function renderRows() {
    const tbody = $("#lead-rows");
    $("#record-count").textContent = `${state.leads.length} record${state.leads.length === 1 ? "" : "s"}`;
    if (!state.leads.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No private leads match this view yet.</td></tr>';
      return;
    }
    tbody.innerHTML = state.leads.map((lead) => `
      <tr tabindex="0" data-lead-id="${escapeHtml(lead.id)}">
        <td><button class="business-link" type="button" data-open-lead="${escapeHtml(lead.id)}">${escapeHtml(lead.businessName)}</button><small>${escapeHtml(lead.city || lead.serviceArea || "City not recorded")}</small></td>
        <td class="why-fit">${escapeHtml(fitReason(lead))}</td>
        <td class="next-action">${escapeHtml(lead.nextAction || "Set a next action")}</td>
        <td class="${isOverdue(lead) ? "due-overdue" : ""}">${isOverdue(lead) ? "Overdue · " : ""}${formatDate(lead.nextActionDue)}</td>
        <td><span class="pill ${["lost", "not_a_fit"].includes(lead.stage) ? "pill-red" : ""}">${escapeHtml(stageLabel(lead.stage))}</span></td>
        <td>${conflict(lead)}</td>
      </tr>`).join("");
    $$('[data-open-lead]', tbody).forEach((button) => button.addEventListener("click", () => openDetail(button.dataset.openLead)));
    $$('tr[data-lead-id]', tbody).forEach((row) => row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetail(row.dataset.leadId);
      }
    }));
  }

  function renderPipeline() {
    $("#pipeline-strip").hidden = state.view !== "pipeline";
    $("#list-title").textContent = state.view === "radar" ? "New Business Radar" : state.view === "all" ? "All Leads" : state.view === "pipeline" ? "Pipeline Leads" : "Today & Next Up";
    $("#pipeline-stages").innerHTML = pipelineStages.map((stage) => `<button class="pipeline-stage" type="button" data-pipeline-stage="${stage}"><strong>${state.pipelineCounts[stage] || 0}</strong><span>${escapeHtml(stageLabel(stage))}</span></button>`).join("");
    $$("[data-pipeline-stage]").forEach((button) => button.addEventListener("click", () => {
      $("#stage-filter").value = button.dataset.pipelineStage;
      load();
    }));
  }

  function demoResponse() {
    const filters = Object.fromEntries(new FormData($("#filters-form")).entries());
    let leads = demoLeads.filter((lead) => filters.archived === "all" || (filters.archived === "only" ? lead.archived : !lead.archived));
    if (state.view === "queue") leads = leads.filter((lead) => !lead.nextActionCompleted && (lead.nextAction || lead.nextActionDue));
    if (state.view === "radar") leads = leads.filter((lead) => lead.contactStatus === "not_contacted" && lead.tidalConflictReviewStatus !== "pending");
    if (filters.stage) leads = leads.filter((lead) => lead.stage === filters.stage);
    if (filters.source) leads = leads.filter((lead) => lead.source === filters.source);
    if (filters.fit) leads = leads.filter((lead) => lead.fitLevel === filters.fit);
    if (filters.conflict) leads = leads.filter((lead) => lead.tidalConflictReviewStatus === filters.conflict);
    if (filters.contact) leads = leads.filter((lead) => lead.contactStatus === filters.contact);
    if (filters.city) leads = leads.filter((lead) => `${lead.city || ""} ${lead.serviceArea || ""}`.toLowerCase().includes(filters.city.toLowerCase()));
    if (filters.industry) leads = leads.filter((lead) => String(lead.industry || "").toLowerCase().includes(filters.industry.toLowerCase()));
    if (filters.services) leads = leads.filter((lead) => lead.servicesInterest.some((value) => value.toLowerCase().includes(filters.services.toLowerCase())));
    if (filters.search) leads = leads.filter((lead) => `${lead.businessName} ${lead.city || ""} ${lead.industry || ""}`.toLowerCase().includes(filters.search.toLowerCase()));
    if (filters.overdue) leads = leads.filter(isOverdue);
    const pipelineCounts = Object.fromEntries(pipelineStages.map((stage) => [stage, demoLeads.filter((lead) => lead.stage === stage).length]));
    return { leads, pipelineCounts, counts: { needsAction: 3, newToReview: 1, conflictReviews: 1 } };
  }

  async function load() {
    showWorkspaceError();
    $("#record-count").textContent = "Loading…";
    try {
      const params = new URLSearchParams({ view: state.view });
      new FormData($("#filters-form")).forEach((value, key) => {
        if (key === "overdue" || value) params.set(key, value === "on" ? "true" : value);
      });
      const body = isDemo() ? demoResponse() : await api(`${LEADS_API}?${params}`);
      state.leads = body.leads || [];
      state.pipelineCounts = body.pipelineCounts || {};
      $("#needs-action-count").textContent = body.counts?.needsAction ?? "0";
      $("#new-review-count").textContent = body.counts?.newToReview ?? "0";
      $("#conflict-count").textContent = body.counts?.conflictReviews ?? "0";
      renderRows();
      renderPipeline();
      if (state.pendingLeadId) {
        const leadId = state.pendingLeadId;
        state.pendingLeadId = null;
        const url = new URL(location.href);
        url.searchParams.delete("lead");
        history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        await openDetail(leadId);
      }
    } catch (error) {
      state.leads = [];
      renderRows();
      showWorkspaceError(error.message);
    }
  }

  const linkList = (values, label) => (values || []).length
    ? `<ul class="link-list">${values.map((value) => `<li><a href="${escapeHtml(value)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a></li>`).join("")}</ul>`
    : "—";

  const relatedRecords = (related = {}) => {
    const intakes = related.intakes || [];
    const sows = related.sows || [];
    const payments = related.payments || [];
    if (!intakes.length && !sows.length && !payments.length) return '<p class="muted">No linked intake, SOW, or payment records yet.</p>';
    return `
      ${intakes.length ? `<h4>Website intake</h4><ul class="related-list">${intakes.map((item) => `<li><a href="/sow-builder.html?intake=${encodeURIComponent(item.id)}">${escapeHtml(item.customer_number)}</a><span>${escapeHtml(stageLabel(item.status))} · ${formatDate(item.created_at)}</span></li>`).join("")}</ul>` : ""}
      ${sows.length ? `<h4>SOWs</h4><ul class="related-list">${sows.map((item) => `<li><a href="/sow-builder.html?intake=${encodeURIComponent(item.intake_submission_id)}">${escapeHtml(item.title)} · v${item.version_number}</a><span>${escapeHtml(stageLabel(item.status))} · ${formatMoney(item.amount_cents)}</span></li>`).join("")}</ul>` : ""}
      ${payments.length ? `<h4>Payments</h4><ul class="related-list">${payments.map((item) => `<li><strong>${formatMoney(item.amount_cents, item.currency)}</strong><span>${escapeHtml(stageLabel(item.status))} · ${formatDate(item.paid_at || item.created_at)}</span></li>`).join("")}</ul>` : ""}`;
  };

  const draftObservation = (lead) => {
    const reason = fitReason(lead);
    if (/viewport|smaller-screen/i.test(reason)) return "the mobile experience may be worth reviewing";
    if (/rely on phone/i.test(reason)) return "the site appears to rely mainly on phone calls for new inquiries";
    if (/service-request|intake form/i.test(reason)) return "there may be an opportunity to make service requests easier online";
    if (/booking/i.test(reason)) return "there may be an opportunity to make scheduling easier online";
    if (/legacy|fixed-width|http|insecure/i.test(reason)) return "the website may benefit from a focused modernization";
    return reason === "Fit reason not recorded" ? "there may be a practical opportunity to improve the website or customer-intake path" : reason.charAt(0).toLowerCase() + reason.slice(1);
  };

  const emailDraftFor = (lead) => ({
    to: lead.publicEmail || "",
    subject: `A practical website idea for ${lead.businessName}`,
    body: `Hello,\n\nI came across ${lead.businessName} while researching service businesses that may benefit from practical website or customer-intake improvements. I noticed ${draftObservation(lead)}.\n\nI run Palmetto Business Automation. I help small businesses create clearer websites, service-request forms, lead workflows, and simple business systems. If this is already working well for you, no action is needed. If it is something you want to improve, I would be glad to share a straightforward recommendation.\n\nWould a brief discovery call be useful?\n\nBest,\nRoss Wyatt\nPalmetto Business Automation\nhttps://palmettobusinessautomation.com`,
  });

  function openEmailDraft(lead) {
    const draft = emailDraftFor(lead);
    state.emailDraftLeadId = lead.id;
    state.emailDraftLogged = false;
    $("#email-draft-to").value = draft.to;
    $("#email-draft-subject").value = draft.subject;
    $("#email-draft-body").value = draft.body;
    $("#email-draft-status").textContent = draft.to
      ? "Draft created from verified lead details. Review it before opening your email app."
      : "No public email is saved for this lead. Add a verified address before using the draft.";
    $("#detail-dialog").close();
    $("#email-draft-dialog").showModal();
    requestAnimationFrame(() => (draft.to ? $("#email-draft-subject") : $("#email-draft-to")).focus());
  }

  async function recordEmailDraftActivity() {
    if (state.emailDraftLogged || !state.emailDraftLeadId || isDemo()) return;
    await api(LEADS_API, { method: "PUT", body: JSON.stringify({
      action: "activity",
      id: state.emailDraftLeadId,
      activityType: "email_drafted",
      note: "Email draft prepared for manual review. No email was sent.",
    }) });
    state.emailDraftLogged = true;
  }

  const emailDraftValues = () => ({
    to: $("#email-draft-to").value.trim(),
    subject: $("#email-draft-subject").value.trim(),
    body: $("#email-draft-body").value.trim(),
  });

  async function copyEmailDraft() {
    const draft = emailDraftValues();
    const status = $("#email-draft-status");
    try {
      await navigator.clipboard.writeText(`${draft.to ? `To: ${draft.to}\n` : ""}Subject: ${draft.subject}\n\n${draft.body}`);
    } catch {
      status.textContent = "The draft could not be copied. Select the text manually and try again.";
      return;
    }
    try {
      await recordEmailDraftActivity();
      status.textContent = "Draft copied. It is still unsent and ready for your review.";
    } catch {
      status.textContent = "Draft copied, but its activity could not be recorded. No email was sent.";
    }
  }

  async function openDraftInEmailApp() {
    const draft = emailDraftValues();
    const recipient = $("#email-draft-to");
    if (draft.to && !recipient.checkValidity()) {
      $("#email-draft-status").textContent = "Enter a valid public business email address first.";
      recipient.focus();
      return;
    }
    try {
      await recordEmailDraftActivity();
    } catch {
      $("#email-draft-status").textContent = "The draft is ready, but its activity could not be recorded. Try again.";
      return;
    }
    const mailto = `mailto:${draft.to}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
    $("#email-draft-dialog").close();
    window.location.href = mailto;
  }

  async function restoreLeadAfterDraft() {
    const leadId = state.emailDraftLeadId;
    state.emailDraftLeadId = null;
    if (leadId) await openDetail(leadId);
  }

  function renderDetail(body) {
    const lead = body.lead;
    $("#detail-title").textContent = lead.businessName;
    $("#detail-content").innerHTML = `
      <div class="detail-top"><span class="pill">${escapeHtml(stageLabel(lead.stage))}</span><span class="pill">${escapeHtml(stageLabel(lead.fitLevel))} fit</span>${conflict(lead)}</div>
      <div class="detail-actions">
        <button class="button button-primary" type="button" data-detail-action="next">Set Next Action</button>
        <button class="button button-secondary" type="button" data-detail-action="edit">Edit Lead</button>
        <button class="button button-secondary" type="button" data-detail-action="draft_email">Create Email Draft</button>
        ${lead.nextAction ? `<button class="button button-secondary" type="button" data-detail-action="${lead.nextActionCompleted ? "reopen" : "complete"}">${lead.nextActionCompleted ? "Reopen Next Action" : "Complete Next Action"}</button>` : ""}
        <button class="button button-secondary" type="button" data-detail-action="do_not_contact">Mark Do Not Contact</button>
        <button class="button button-secondary" type="button" data-detail-action="archive">Archive Lead</button>
      </div>
      <div class="detail-next"><h3>Next action</h3><p><strong>${escapeHtml(lead.nextAction || "No next action set")}</strong> · ${formatDate(lead.nextActionDue)} · ${escapeHtml(lead.nextActionOwner || "Owner")}${lead.nextActionCompleted ? " · Completed" : ""}</p></div>
      <p class="form-error" id="detail-error" role="alert"></p>
      <div class="detail-sections">
        <article class="detail-card"><h3>Overview</h3><dl>
          <dt>City / area</dt><dd>${escapeHtml(lead.city || "—")} / ${escapeHtml(lead.serviceArea || "—")}</dd>
          <dt>Industry</dt><dd>${escapeHtml(lead.industry || "—")}</dd>
          <dt>Website</dt><dd>${lead.websiteUrl ? `<a class="business-link" href="${escapeHtml(lead.websiteUrl)}" target="_blank" rel="noreferrer">${escapeHtml(lead.normalizedDomain)}</a>` : "—"}</dd>
          <dt>Public phone</dt><dd>${escapeHtml(lead.publicPhone || "—")}</dd>
          <dt>Public email</dt><dd>${escapeHtml(lead.publicEmail || "—")}</dd>
          <dt>Contact status</dt><dd>${escapeHtml(stageLabel(lead.contactStatus))}</dd>
          <dt>Source</dt><dd>${escapeHtml(stageLabel(lead.source))}</dd>
          <dt>Services</dt><dd>${escapeHtml((lead.servicesInterest || []).join(", ") || "—")}</dd>
          <dt>Created</dt><dd>${formatDate(lead.createdAt)}</dd>
        </dl></article>
        <article class="detail-card"><h3>Research</h3><dl>
          <dt>Formation date</dt><dd>${formatDate(lead.formationDate)} (${escapeHtml(stageLabel(lead.dateConfidence))})</dd>
          <dt>Opened date</dt><dd>${formatDate(lead.openedDate)}</dd>
          <dt>Discovered</dt><dd>${formatDate(lead.discoveredDate)}</dd>
          <dt>Launch signals</dt><dd>${escapeHtml((lead.launchSignals || []).join(", ") || "—")}</dd>
          <dt>Last verified</dt><dd>${formatDate(lead.lastVerifiedDate)}</dd>
          <dt>Fit reasons</dt><dd>${escapeHtml((lead.fitReasons || []).join(", ") || "—")}</dd>
          <dt>Sources</dt><dd>${linkList(lead.sourceUrls, "Open source")}</dd>
          <dt>Notes</dt><dd>${escapeHtml(lead.internalNotes || "—")}</dd>
        </dl></article>
        <article class="detail-card span-two"><h3>Activity</h3><ol class="activity-list">${(body.activities || []).map((item) => `<li><small>${formatDate(item.created_at)} · ${escapeHtml(item.owner_email)}</small><strong>${escapeHtml(stageLabel(item.activity_type))}</strong><div>${escapeHtml(item.note)}</div></li>`).join("") || "<li>No activity recorded yet.</li>"}</ol>
          <form id="activity-form" class="activity-form"><label>Activity type<select name="activityType"><option value="internal_note">Internal note</option><option value="research_added">Research added</option><option value="call_attempted">Call attempted</option><option value="email_drafted">Email drafted</option><option value="email_sent_manually">Email sent manually</option><option value="replied">Replied</option><option value="discovery_scheduled">Discovery scheduled</option><option value="discovery_completed">Discovery completed</option><option value="scope_sent">Scope sent</option><option value="sow_accepted">SOW accepted</option><option value="payment_received">Payment received</option><option value="lost">Lost</option><option value="not_a_fit">Not a fit</option></select></label><label class="activity-note">Note<input name="note" required maxlength="2000" placeholder="Add a short internal note" /></label><button class="button button-primary" type="submit">Add Activity</button></form>
        </article>
        <article class="detail-card span-two"><h3>Related Records</h3>${relatedRecords(body.related)}</article>
      </div>`;

    $("#activity-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        await api(LEADS_API, { method: "PUT", body: JSON.stringify({ action: "activity", id: lead.id, note: form.get("note"), activityType: form.get("activityType") }) });
        await openDetail(lead.id);
      } catch (error) {
        $("#detail-error").textContent = error.message;
      }
    });
    $$("[data-detail-action]", $("#detail-content")).forEach((button) => button.addEventListener("click", async () => {
      const action = button.dataset.detailAction;
      if (action === "draft_email") {
        openEmailDraft(lead);
        return;
      }
      if (action === "edit" || action === "next") {
        $("#detail-dialog").close();
        openLeadForm(lead, action === "next" ? "nextAction" : "businessName");
        return;
      }
      if (action === "archive" && !window.confirm("Archive this lead? It can be restored from the Archived filter.")) return;
      const data = { id: lead.id, action };
      if (action === "do_not_contact") {
        const reason = window.prompt("Reason for do-not-contact status (optional):", lead.doNotContactReason || "");
        if (reason === null) return;
        data.doNotContactReason = reason;
      }
      try {
        await api(LEADS_API, { method: "PUT", body: JSON.stringify(data) });
        if (action === "complete" || action === "reopen") {
          await load();
          await openDetail(lead.id);
          return;
        }
        $("#detail-dialog").close();
        await load();
      } catch (error) {
        $("#detail-error").textContent = error.message;
      }
    }));
  }

  async function openDetail(id) {
    try {
      const body = isDemo()
        ? { lead: demoLeads.find((item) => item.id === id), activities: [{ activity_type: "research_added", note: "Research added from a public source; verify before outreach.", owner_email: "demo owner", created_at: "2026-08-25" }], related: {} }
        : await api(`${LEADS_API}?id=${encodeURIComponent(id)}`);
      state.selected = body;
      renderDetail(body);
      if (!$("#detail-dialog").open) $("#detail-dialog").showModal();
    } catch (error) {
      showWorkspaceError(error.message);
    }
  }

  function setField(form, name, value) {
    const field = form.elements.namedItem(name);
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = Array.isArray(value) ? value.join(", ") : value || "";
  }

  function openLeadForm(lead = null, focusName = "businessName") {
    const form = $("#lead-form");
    form.reset();
    // Explicitly clear edit identity before Add Lead. Some browsers preserve
    // a hidden input's programmatically assigned value across form.reset().
    setField(form, "id", lead?.id || "");
    $("#lead-form-error").textContent = "";
    $("#dialog-title").textContent = lead ? "Edit Lead" : "Add Lead";
    $("#save-lead").textContent = lead ? "Save changes" : "Save lead";
    if (lead) {
      for (const [key, value] of Object.entries(lead)) setField(form, key, value);
    } else {
      setField(form, "discoveredDate", new Date().toISOString().slice(0, 10));
      setField(form, "nextActionOwner", "Owner");
    }
    if (!$("#lead-dialog").open) $("#lead-dialog").showModal();
    requestAnimationFrame(() => form.elements.namedItem(focusName)?.focus());
  }

  const formPayload = (form) => {
    const data = Object.fromEntries(new FormData(form).entries());
    for (const key of LIST_FIELDS) data[key] = String(data[key] || "").split(",").map((item) => item.trim()).filter(Boolean);
    for (const key of BOOLEAN_FIELDS) data[key] = Boolean(form.elements.namedItem(key)?.checked);
    return data;
  };

  async function saveLead(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formPayload(form);
    const editing = Boolean(data.id);
    const submit = async () => api(LEADS_API, { method: editing ? "PUT" : "POST", body: JSON.stringify(data) });
    $("#save-lead").disabled = true;
    $("#lead-form-error").textContent = "";
    try {
      await submit();
      $("#lead-dialog").close();
      await load();
    } catch (error) {
      if (error.status === 409 && error.body?.duplicates?.length) {
        const names = error.body.duplicates.map((lead) => `${lead.business_name}${lead.city ? ` (${lead.city})` : ""}`).join("\n");
        if (window.confirm(`${error.message}\n\n${names}\n\nSave as a separate record after reviewing these matches?`)) {
          try {
            data.confirmDuplicate = true;
            await submit();
            $("#lead-dialog").close();
            await load();
            return;
          } catch (retryError) {
            error = retryError;
          }
        }
      }
      $("#lead-form-error").textContent = error.message;
    } finally {
      $("#save-lead").disabled = false;
    }
  }

  function setView(view) {
    state.view = view;
    $("#discovery-panel").hidden = view !== "radar";
    $$(".view-tab").forEach((item) => {
      const active = item.dataset.view === view;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    load();
  }

  let filterTimer;
  $("#filters-form").addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(load, 250);
  });
  $("#clear-filters").addEventListener("click", () => { $("#filters-form").reset(); load(); });
  $("#add-lead-button").addEventListener("click", () => openLeadForm());
  $("#close-lead").addEventListener("click", () => $("#lead-dialog").close());
  $("#cancel-lead").addEventListener("click", () => $("#lead-dialog").close());
  $("#close-detail").addEventListener("click", () => $("#detail-dialog").close());
  $("#close-email-draft").addEventListener("click", () => $("#email-draft-dialog").close());
  $("#cancel-email-draft").addEventListener("click", () => $("#email-draft-dialog").close());
  $("#copy-email-draft").addEventListener("click", copyEmailDraft);
  $("#open-email-app").addEventListener("click", openDraftInEmailApp);
  $("#email-draft-dialog").addEventListener("close", restoreLeadAfterDraft);
  $("#lead-form").addEventListener("submit", saveLead);
  $("#discovery-form").addEventListener("submit", runDiscovery);
  $$('.discovery-quick-actions [data-discovery-focus]').forEach((button) => button.addEventListener("click", () => runQuickDiscovery(button)));
  $$(".view-tab").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$('[data-summary]').forEach((button) => button.addEventListener("click", () => {
    $("#filters-form").reset();
    const key = button.dataset.summary;
    if (key === "needsAction") return setView("queue");
    if (key === "newToReview") $("#stage-filter").value = "new";
    if (key === "conflictReviews") $("#conflict-filter").value = "pending";
    setView("all");
  }));

  $$(".view-tab").forEach((item) => item.setAttribute("aria-pressed", String(item.classList.contains("active"))));
  load();
})();
