(() => {
  const form = document.querySelector("#sow-builder-form");
  const intakeSelect = document.querySelector("#intake-select");
  const intakeSummary = document.querySelector("#intake-summary");
  const sections = document.querySelector("#sections");
  const previewSections = document.querySelector("#preview-sections");
  const error = document.querySelector("#builder-error");
  const success = document.querySelector("#builder-success");
  const byName = (name) => form.elements.namedItem(name);
  let intakes = [];

  const setError = (message = "") => { error.textContent = message; };
  const esc = (value) => String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));

  const addSection = (title = "", body = "") => {
    const wrapper = document.createElement("div");
    wrapper.className = "scope-section";
    const titleLabel = document.createElement("label");
    titleLabel.textContent = "Section title";
    const titleInput = document.createElement("input");
    titleInput.name = "sectionTitle";
    titleInput.value = title;
    titleInput.required = true;
    titleInput.maxLength = 200;
    titleLabel.appendChild(titleInput);
    const bodyLabel = document.createElement("label");
    bodyLabel.textContent = "Scope details";
    const bodyInput = document.createElement("textarea");
    bodyInput.name = "sectionBody";
    bodyInput.value = body;
    bodyInput.required = true;
    bodyInput.maxLength = 8_000;
    bodyInput.placeholder = "Describe what is included, delivered, or excluded.";
    bodyLabel.appendChild(bodyInput);
    const remove = document.createElement("button");
    remove.className = "mini-button remove-section";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => { if (sections.children.length > 1) { wrapper.remove(); refreshPreview(); } });
    wrapper.append(titleLabel, bodyLabel, remove);
    sections.appendChild(wrapper);
    titleInput.addEventListener("input", refreshPreview);
    bodyInput.addEventListener("input", refreshPreview);
  };

  const readSections = () => [...sections.querySelectorAll(".scope-section")].map((row) => ({
    title: row.querySelector('[name="sectionTitle"]').value.trim(),
    body: row.querySelector('[name="sectionBody"]').value.trim(),
  }));

  const prefillSection = (title, body) => {
    if (!body) return;
    const row = [...sections.querySelectorAll(".scope-section")].find((section) =>
      section.querySelector('[name="sectionTitle"]').value.trim().toLowerCase() === title.toLowerCase(),
    );
    const details = row?.querySelector('[name="sectionBody"]');
    if (details && !details.value.trim()) details.value = body;
  };

  const refreshPreview = () => {
    const selected = intakes.find((item) => item.id === intakeSelect.value);
    document.querySelector("#preview-title").textContent = byName("title").value || "Your project title";
    document.querySelector("#preview-customer").textContent = selected?.customer_number || "Customer number";
    document.querySelector("#preview-version").textContent = selected?.sow_version ? `Version ${Number(selected.sow_version) + 1}` : "New version";
    document.querySelector("#preview-client").textContent = `Prepared for ${byName("clientName").value || "client"}`;
    previewSections.replaceChildren();
    readSections().forEach((section) => {
      const article = document.createElement("article");
      const heading = document.createElement("h3");
      heading.textContent = section.title || "Untitled section";
      article.appendChild(heading);
      section.body.split("\n").filter(Boolean).forEach((line) => { const p = document.createElement("p"); p.textContent = line; article.appendChild(p); });
      previewSections.appendChild(article);
    });
    const payment = document.createElement("article");
    const paymentHeading = document.createElement("h3");
    paymentHeading.textContent = "Payment schedule";
    const paymentBody = document.createElement("p");
    const recurring = byName("billingType").value === "recurring_monthly";
    paymentBody.textContent = `${byName("paymentLabel").value || "Payment"}: ${money(Number(byName("amount").value || 0))}${recurring ? " per month, billed automatically until canceled under the agreement" : ""}.`;
    payment.append(paymentHeading, paymentBody);
    previewSections.appendChild(payment);
  };

  const selectIntake = () => {
    const selected = intakes.find((item) => item.id === intakeSelect.value);
    if (!selected) { intakeSummary.hidden = true; refreshPreview(); return; }
    byName("clientName").value = selected.full_name || "";
    byName("clientEmail").value = selected.email || "";
    if (!byName("title").value) byName("title").value = `${selected.organization || selected.full_name} project scope`;
    prefillSection("Business problem", selected.problem);
    prefillSection("Desired outcomes", selected.outcomes);
    intakeSummary.innerHTML = `<strong>${esc(selected.customer_number)} · ${esc(selected.organization)}</strong><br>${esc(selected.email)}<br><span>${esc(selected.problem || "No problem statement provided.")}</span>`;
    intakeSummary.hidden = false;
    refreshPreview();
  };

  const loadIntakes = async () => {
    const response = await fetch("/api/intakes", { headers: { accept: "application/json" } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load intakes. Confirm owner access is active.");
    intakes = result.intakes || [];
    intakeSelect.replaceChildren(new Option("Choose an intake", ""));
    intakes.forEach((item) => {
      const label = `${item.customer_number} · ${item.organization || item.full_name}${item.sow_status ? ` · latest SOW ${item.sow_status}` : ""}`;
      intakeSelect.appendChild(new Option(label, item.id));
    });
    if (!intakes.length) intakeSelect.replaceChildren(new Option("No intakes found", ""));
  };

  document.querySelector("#add-section").addEventListener("click", () => { addSection(); refreshPreview(); });
  intakeSelect.addEventListener("change", selectIntake);
  document.querySelector("#preview-button").addEventListener("click", refreshPreview);
  ["title", "clientName", "clientEmail", "billingType", "amount", "paymentLabel", "paymentDueAt", "paymentTerms"].forEach((name) => byName(name).addEventListener("input", refreshPreview));
  byName("billingType").addEventListener("change", refreshPreview);

  form.addEventListener("submit", async (event) => {
    event.preventDefault(); setError(""); success.hidden = true;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const payload = {
      intakeId: data.get("intakeId"), title: data.get("title"), clientName: data.get("clientName"), clientEmail: data.get("clientEmail"),
      billingType: data.get("billingType"), amountCents: Math.round(Number(data.get("amount")) * 100), paymentLabel: data.get("paymentLabel"),
      paymentDueAt: data.get("paymentDueAt") || null, paymentTerms: data.get("paymentTerms"), sections: readSections(),
    };
    const button = form.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = "Publishing…";
    try {
      const response = await fetch("/api/publish-sow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to publish this SOW.");
      success.innerHTML = `<strong>SOW published for ${esc(result.customerNumber)}.</strong><br>The client review link is ready:<br><a href="${esc(result.reviewUrl)}" target="_blank" rel="noreferrer">${esc(result.reviewUrl)}</a><br><button type="button" class="button button-secondary copy-link">Copy secure link</button>`;
      success.hidden = false;
      success.querySelector(".copy-link").addEventListener("click", async () => { await navigator.clipboard.writeText(result.reviewUrl); success.querySelector(".copy-link").textContent = "Copied"; });
      await loadIntakes();
    } catch (publishError) { setError(publishError.message); }
    finally { button.disabled = false; button.textContent = "Publish SOW and send link"; }
  });

  addSection("Business problem", "");
  addSection("Desired outcomes", "");
  addSection("Included scope", "");
  loadIntakes().catch((loadError) => setError(loadError.message));
  refreshPreview();
})();
