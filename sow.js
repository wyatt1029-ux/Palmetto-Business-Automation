(() => {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const token = params.get("token");
  const message = document.querySelector("#sow-message");
  const messageTitle = document.querySelector("#message-title");
  const messageCopy = document.querySelector("#message-copy");
  const documentPanel = document.querySelector("#sow-document");
  const decisionPanel = document.querySelector("#sow-decision");
  const error = document.querySelector("#sow-error");
  const approvalForm = document.querySelector("#approval-form");
  const changesForm = document.querySelector("#changes-form");
  const messageActions = document.querySelector("#message-actions");

  const showMessage = (title, copy, paymentUrl = null) => {
    message.hidden = false;
    documentPanel.hidden = true;
    decisionPanel.hidden = true;
    messageTitle.textContent = title;
    messageCopy.textContent = copy;
    messageActions.replaceChildren();
    if (paymentUrl) {
      const link = document.createElement("a");
      link.className = "button button-primary";
      link.href = paymentUrl;
      link.textContent = "Pay securely";
      messageActions.appendChild(link);
    }
  };

  const submitDecision = async (action, payload) => {
    error.textContent = "";
    document.querySelectorAll(".sow-action").forEach((button) => { button.disabled = true; });
    try {
      const response = await fetch("/api/sow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, token, action, ...payload }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save your decision.");
      showMessage(
        action === "approve" ? "Scope approved" : "Changes requested",
        action === "approve"
          ? "Thank you. Your approval has been recorded with this exact SOW version. Complete secure payment next; once payment is received, PBA will schedule kickoff."
          : "Thank you. Your notes have been recorded and PBA will send a revised version for review.",
        result.paymentUrl
      );
    } catch (err) {
      error.textContent = err.message;
      document.querySelectorAll(".sow-action").forEach((button) => { button.disabled = false; });
    }
  };

  approvalForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!approvalForm.reportValidity()) return;
    const approvalData = new FormData(approvalForm);
    submitDecision("approve", {
      signerName: approvalData.get("signerName"),
      autopayConfirmed: approvalData.get("autopayConfirmation") === "on",
    });
  });
  changesForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!changesForm.reportValidity()) return;
    submitDecision("request_changes", { notes: new FormData(changesForm).get("notes") });
  });

  if (!id || !token) {
    showMessage("This link is incomplete", "Ask PBA to send a new secure scope review link.");
    return;
  }

  fetch(`/api/sow?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`, { headers: { accept: "application/json" } })
    .then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to open this SOW.");
      return result;
    })
    .then(({ sow }) => {
      document.querySelector("#sow-title").textContent = sow.title;
      document.querySelector("#sow-version").textContent = `Version ${sow.versionNumber}`;
      document.querySelector("#sow-client").textContent = `Prepared for ${sow.clientName}`;
      document.querySelector("#sow-customer-number").textContent = sow.customerNumber;
      document.querySelector("#sow-status").textContent = sow.status.replaceAll("_", " ");
      const autopayConsent = document.querySelector("#autopay-consent");
      const autopayInput = autopayConsent.querySelector("input");
      autopayConsent.hidden = sow.billingType !== "recurring_monthly";
      autopayInput.disabled = sow.billingType !== "recurring_monthly";
      autopayInput.required = sow.billingType === "recurring_monthly";
      const sections = document.querySelector("#sow-sections");
      sow.sections.forEach((section) => {
        const article = document.createElement("article");
        const heading = document.createElement("h2");
        const body = document.createElement("div");
        heading.textContent = section.title;
        section.body.split("\n").filter(Boolean).forEach((line) => {
          const paragraph = document.createElement("p");
          paragraph.textContent = line;
          body.appendChild(paragraph);
        });
        article.append(heading, body);
        sections.appendChild(article);
      });
      const scopeChangeArticle = document.createElement("article");
      const scopeChangeHeading = document.createElement("h2");
      const scopeChangeBody = document.createElement("p");
      scopeChangeHeading.textContent = "Changes to scope";
      scopeChangeBody.textContent = "Requests outside the approved scope will be quoted separately and will not begin until approved in writing.";
      scopeChangeArticle.append(scopeChangeHeading, scopeChangeBody);
      sections.appendChild(scopeChangeArticle);
      const paymentArticle = document.createElement("article");
      const paymentHeading = document.createElement("h2");
      const paymentBody = document.createElement("div");
      paymentHeading.textContent = "Payment schedule";
      const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(sow.amountCents / 100);
      [
        `${sow.paymentLabel}: ${amount}${sow.billingType === "recurring_monthly" ? " per month, billed automatically until canceled under the agreement" : ""}.`,
        sow.paymentDueAt ? `Automatic payment setup due: ${formatPaymentDate(sow.paymentDueAt)}.` : "",
        sow.paymentTerms,
      ].filter(Boolean).forEach((line) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = line;
        paymentBody.appendChild(paragraph);
      });
      paymentArticle.append(paymentHeading, paymentBody);
      sections.appendChild(paymentArticle);
      const kickoffArticle = document.createElement("article");
      const kickoffHeading = document.createElement("h2");
      const kickoffBody = document.createElement("p");
      kickoffHeading.textContent = "Project payment and kickoff";
      kickoffBody.textContent = "Your Statement of Work identifies the agreed scope, price, payment timing, and any client responsibilities. Work begins after the SOW is approved and the required initial payment has been received.";
      kickoffArticle.append(kickoffHeading, kickoffBody);
      sections.appendChild(kickoffArticle);
      if (sow.billingType === "recurring_monthly") {
        const careArticle = document.createElement("article");
        const careHeading = document.createElement("h2");
        const careBody = document.createElement("p");
        careHeading.textContent = "Ongoing care";
        careBody.textContent = "Optional care plans are billed automatically monthly in advance. Either party may cancel ongoing care with 30 days’ written notice.";
        careArticle.append(careHeading, careBody);
        sections.appendChild(careArticle);
      }
      message.hidden = true;
      documentPanel.hidden = false;
      decisionPanel.hidden = sow.status !== "sent";
      if (sow.status !== "sent") showMessage(
        sow.status === "approved" ? "Already approved" : "This version is closed",
        sow.status === "approved"
          ? (sow.paymentStatus === "paid" ? "This SOW is approved and payment has been received." : "This SOW version has been approved and is ready for secure payment.")
          : "A newer version may be available. Ask PBA for the latest secure review link.",
        sow.paymentUrl || sow.billingPortalUrl
      );
  })
    .catch((err) => showMessage("Unable to open this SOW", err.message));

  function formatPaymentDate(value) {
    const raw = String(value).slice(0, 10);
    const date = new Date(`${raw}T12:00:00`);
    return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString();
  }
})();
