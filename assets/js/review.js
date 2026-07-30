(() => {
  const list = document.querySelector("#review-list");
  const detail = document.querySelector("#review-detail");
  const reviewForm = document.querySelector("#review-form");
  const publishForm = document.querySelector("#publish-form");
  const message = document.querySelector("#review-message");
  let records = [];
  let selected = null;

  const answer = (label, value) =>
    value ? `<article><h3>${label}</h3><p></p></article>` : "";

  const renderSelected = () => {
    if (!selected) return;
    detail.hidden = false;
    document.querySelector("#review-number").textContent = selected.customer_number;
    document.querySelector("#review-organization").textContent = selected.organization;
    document.querySelector("#review-contact").textContent = `${selected.full_name} · ${selected.email} · ${selected.role}`;
    document.querySelector("#review-status").textContent = selected.status.replaceAll("_", " ");
    const answers = [
      ["Business problem", selected.problem],
      ["Desired outcomes", selected.outcomes],
      ["Users", selected.users],
      ["Current workflow", selected.current_workflow],
      ["Requested features", selected.features],
      ["Integrations", selected.integrations],
      ["Constraints", selected.constraints],
      ["Supporting context", selected.context],
      ["Timeline and budget", `${selected.timeline} · ${selected.budget}`],
      ["Decision process", selected.decision_process],
    ].filter(([, value]) => value);
    const container = document.querySelector("#review-answers");
    container.innerHTML = answers.map(([label, value]) => answer(label, value)).join("");
    [...container.children].forEach((element, index) => {
      element.querySelector("p").textContent = answers[index][1];
    });
    reviewForm.elements.status.value = selected.status;
    reviewForm.elements.internalNotes.value = selected.internal_notes || "";
    publishForm.elements.title.value ||= `${selected.organization} project`;
    publishForm.elements.clientName.value = selected.full_name;
    publishForm.elements.clientEmail.value = selected.email;
    publishForm.elements.scope.value ||= selected.features;
    publishForm.elements.timelineSection.value ||= selected.timeline;
  };

  const renderList = () => {
    list.innerHTML = "";
    records.forEach((record) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "review-list-item";
      button.innerHTML = `<strong></strong><span></span><small></small>`;
      button.querySelector("strong").textContent = record.organization;
      button.querySelector("span").textContent = record.customer_number;
      button.querySelector("small").textContent = record.status.replaceAll("_", " ");
      button.addEventListener("click", () => {
        selected = record;
        renderSelected();
      });
      list.appendChild(button);
    });
  };

  const load = async () => {
    const response = await fetch("/api/review");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Owner access is required.");
    records = result.intakes;
    renderList();
    if (records.length) {
      selected = records[0];
      renderSelected();
    } else {
      list.innerHTML = "<p>No intake records yet.</p>";
    }
  };

  reviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Saving…";
    const data = Object.fromEntries(new FormData(reviewForm).entries());
    data.id = selected.id;
    const response = await fetch("/api/review", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) return void (message.textContent = result.error || "Unable to save.");
    selected.status = result.intake.status;
    selected.internal_notes = result.intake.internal_notes;
    renderList();
    renderSelected();
    message.textContent = "Review saved.";
  });

  publishForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Publishing SOW…";
    const fields = Object.fromEntries(new FormData(publishForm).entries());
    const payload = {
      intakeId: selected.id,
      title: fields.title,
      clientName: fields.clientName,
      clientEmail: fields.clientEmail,
      billingType: fields.billingType,
      amountCents: Math.round(Number(fields.amount) * 100),
      paymentLabel: fields.paymentLabel,
      paymentDueAt: fields.paymentDueAt || null,
      paymentTerms: fields.paymentTerms,
      sections: [
        { title: "Project scope", body: fields.scope },
        { title: "Deliverables", body: fields.deliverables },
        { title: "Timeline", body: fields.timelineSection },
        { title: "Responsibilities and assumptions", body: fields.responsibilities },
      ],
    };
    const response = await fetch("/api/publish-sow", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) return void (message.textContent = result.error || "Unable to publish SOW.");
    message.textContent = `SOW version ${result.version} published for ${result.customerNumber}.`;
  });

  load().catch((error) => {
    list.innerHTML = "";
    message.textContent = error.message;
    detail.hidden = false;
  });
})();
