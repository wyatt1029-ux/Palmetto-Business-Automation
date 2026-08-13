(() => {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const token = params.get("token");
  const sessionId = params.get("session_id");
  const title = document.querySelector("#payment-title");
  const copy = document.querySelector("#payment-copy");
  const summary = document.querySelector("#payment-summary");
  const button = document.querySelector("#payment-button");
  const billingButton = document.querySelector("#billing-button");
  const error = document.querySelector("#payment-error");

  const money = (cents, currency = "usd") =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

  const showQuote = (quote) => {
    const recurringActive = quote.billingType === "recurring_monthly" && quote.billingStatus === "active";
    title.textContent = recurringActive ? "Automatic payment is active" : quote.paymentStatus === "paid" ? "Payment received" : "Ready when you are.";
    copy.textContent = recurringActive
      ? "Your monthly payment method is on file. You can securely update it through Stripe."
      : quote.paymentStatus === "paid"
        ? "Thank you. Your payment has been confirmed."
        : "Everything is already connected to your approved quote—nothing to enter.";
    document.querySelector("#payment-customer").textContent = quote.customerNumber;
    document.querySelector("#payment-project").textContent = quote.title;
    document.querySelector("#payment-amount").textContent = `${money(quote.amountCents, quote.currency)}${quote.billingType === "recurring_monthly" ? " / month" : ""}`;
    document.querySelector("#payment-amount-label").textContent = quote.paymentLabel || "Amount due";
    document.querySelector("#payment-schedule").textContent = quote.billingType === "recurring_monthly" ? "Monthly automatic payment" : "One-time payment";
    const dueRow = document.querySelector("#payment-due-row");
    dueRow.hidden = !quote.paymentDueAt;
    document.querySelector("#payment-due").textContent = quote.paymentDueAt ? new Date(`${quote.paymentDueAt}T12:00:00`).toLocaleDateString() : "";
    const terms = document.querySelector("#payment-terms");
    terms.hidden = !quote.paymentTerms;
    terms.querySelector("p").textContent = quote.paymentTerms || "";
    summary.hidden = false;
    button.hidden = quote.paymentStatus === "paid" || recurringActive;
    button.textContent = quote.billingType === "recurring_monthly" ? "Set up secure automatic payment" : "Continue to secure payment";
    billingButton.hidden = !recurringActive;
  };

  const load = async () => {
    try {
      const query = sessionId
        ? `session_id=${encodeURIComponent(sessionId)}`
        : `id=${encodeURIComponent(id || "")}&token=${encodeURIComponent(token || "")}`;
      const response = await fetch(`/api/payment?${query}`, { headers: { accept: "application/json" } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to open this payment.");
      showQuote(result.quote);
    } catch (err) {
      title.textContent = "Unable to open this payment";
      copy.textContent = "Ask PBA to resend your secure quote link.";
      error.textContent = err.message;
    }
  };

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Opening Stripe…";
    error.textContent = "";
    try {
      const response = await fetch("/api/payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, token }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to start payment.");
      location.assign(result.checkoutUrl);
    } catch (err) {
      error.textContent = err.message;
      button.disabled = false;
      button.textContent = "Continue to secure payment";
    }
  });
  billingButton.addEventListener("click", async () => {
    billingButton.disabled = true;
    billingButton.textContent = "Opening Stripe…";
    error.textContent = "";
    try {
      const response = await fetch("/api/billing-portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, token }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to open billing management.");
      location.assign(result.portalUrl);
    } catch (err) {
      error.textContent = err.message;
      billingButton.disabled = false;
      billingButton.textContent = "Manage automatic payment";
    }
  });
  load();
})();
