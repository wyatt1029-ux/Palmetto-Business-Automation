(() => {
  const form = document.querySelector("#intake-form");
  if (!form) return;
  const steps = [...form.querySelectorAll(".form-step")];
  const next = document.querySelector("#next-button");
  const back = document.querySelector("#back-button");
  const error = document.querySelector("#form-error");
  const fill = document.querySelector("#progress-fill");
  const label = document.querySelector("#step-label");
  const title = document.querySelector("#form-title");
  const help = document.querySelector("#step-help");
  const success = document.querySelector("#intake-success");
  const successEyebrow = document.querySelector("#success-eyebrow");
  const successTitle = document.querySelector("#success-title");
  const successSummary = document.querySelector("#success-summary");
  const emailStatus = document.querySelector("#email-status");
  const revisionLinkWrap = document.querySelector("#revision-link-wrap");
  const revisionLink = document.querySelector("#revision-link");
  const pageTitle = document.querySelector("#intake-page-title");
  const turnstileContainer = document.querySelector("#turnstile-container");
  const params = new URLSearchParams(window.location.search);
  const revisionSubmission = params.get("submission") || "";
  const revisionToken = params.get("token") || "";
  const revisionMode = Boolean(revisionSubmission || revisionToken);
  const headings = [
    ["Tell me about you", "A few details so I know who to follow up with."],
    ["Define the opportunity", "What needs to change, and why does it matter?"],
    ["Map the current workflow", "The existing process helps shape the right solution."],
    ["Shape the first version", "Prioritize the capabilities and constraints that matter."],
    ["Timing and next steps", "These answers help set a useful conversation."],
  ];
  let current = 0;
  let turnstileToken = "";
  let turnstileWidgetId = null;

  const populateRevision = (intake) => {
    const values = {
      fullName: intake.fullName,
      email: intake.email,
      organization: intake.organization,
      role: intake.role,
      problem: intake.problem,
      outcomes: intake.outcomes,
      users: intake.users,
      currentWorkflow: intake.currentWorkflow,
      integrations: intake.integrations,
      features: intake.features,
      constraints: intake.constraints,
      context: intake.context,
      timeline: intake.timeline,
      budget: intake.budget,
      decisionProcess: intake.decisionProcess,
    };
    Object.entries(values).forEach(([name, value]) => {
      const field = form.elements.namedItem(name);
      if (field) field.value = value || "";
    });
    pageTitle.textContent = "Review and update your project intake.";
    document.title = `Update ${intake.customerNumber} | Palmetto Business Automation`;
  };

  const loadRevision = async () => {
    if (!revisionSubmission || !revisionToken) {
      throw new Error("This revision link is incomplete. Please use the complete link from your email.");
    }
    const query = new URLSearchParams({ submission: revisionSubmission, token: revisionToken });
    const response = await fetch(`/api/intake?${query}`, { headers: { accept: "application/json" } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "This revision link could not be opened.");
    populateRevision(result.intake);
  };

  const initializeTurnstile = async () => {
    let siteKey = "";
    try {
      const response = await fetch("/api/public-config", { headers: { accept: "application/json" } });
      if (response.ok) siteKey = (await response.json()).turnstileSiteKey || "";
    } catch {
      // The message below keeps the form usable and explains what is missing.
    }
    if (!siteKey) {
      turnstileContainer.textContent = "Security verification is not configured.";
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      turnstileWidgetId = window.turnstile.render(turnstileContainer, {
        sitekey: siteKey,
        callback: (token) => { turnstileToken = token; },
        "expired-callback": () => { turnstileToken = ""; },
        "error-callback": () => { turnstileToken = ""; },
      });
    };
    document.head.appendChild(script);
  };

  const show = (index) => {
    current = index;
    steps.forEach((step, stepIndex) => step.classList.toggle("is-active", stepIndex === current));
    label.textContent = `Step ${current + 1} of ${steps.length}`;
    title.textContent = headings[current][0];
    help.textContent = headings[current][1];
    fill.style.width = `${((current + 1) / steps.length) * 100}%`;
    back.hidden = current === 0;
    next.textContent = current === steps.length - 1 ? "Send intake" : "Continue";
    error.textContent = "";
    steps[current].querySelector("input, textarea, select")?.focus();
  };

  const valid = () => {
    const fields = [...steps[current].querySelectorAll("input, textarea, select")]
      .filter((field) => !field.classList.contains("honey"));
    const firstInvalid = fields.find((field) => !field.checkValidity());
    if (firstInvalid) {
      firstInvalid.reportValidity();
      return false;
    }
    return true;
  };

  next.addEventListener("click", async () => {
    if (!valid()) return;
    if (current < steps.length - 1) return show(current + 1);
    if (!turnstileToken) {
      error.textContent = "Please complete the security check before sending.";
      return;
    }
    next.disabled = true;
    error.textContent = "";
    const data = Object.fromEntries(new FormData(form).entries());
    data.turnstileToken = turnstileToken;
    data.idempotencyKey = form.dataset.idempotencyKey;
    if (revisionMode) {
      data.submission = revisionSubmission;
      data.token = revisionToken;
    }
    try {
      const response = await fetch("/api/intake", {
        method: revisionMode ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Submission failed");
      document.querySelector("#customer-number").textContent = result.customerNumber;
      if (revisionMode) {
        successEyebrow.textContent = "Updated";
        successTitle.textContent = "Your project intake is up to date.";
        const customerNumber = document.createElement("strong");
        customerNumber.textContent = result.customerNumber;
        successSummary.replaceChildren(
          "Your customer number remains ",
          customerNumber,
          ". PBA will review the latest information.",
        );
        emailStatus.textContent = "You can use the same secure link again until it expires.";
      } else {
        emailStatus.textContent = result.duplicate
          ? "This intake was already received. Use the secure revision link from your confirmation email if you need to make changes."
          : result.emailDelivered
            ? "A secure revision link has been sent to your email. Save it if you may need to update these details."
            : "Your intake was saved, but the confirmation email could not be sent. Please save the secure revision link below.";
        if (result.revisionUrl) {
          revisionLink.href = result.revisionUrl;
          revisionLinkWrap.hidden = false;
        }
      }
      form.hidden = true;
      success.hidden = false;
    } catch (submitError) {
      error.textContent = submitError.message || "I couldn’t send that yet. Please try again, or email hello@palmettobusinessautomation.com.";
      if (turnstileWidgetId !== null) window.turnstile?.reset(turnstileWidgetId);
      turnstileToken = "";
      next.disabled = false;
    }
  });

  back.addEventListener("click", () => show(current - 1));
  form.dataset.idempotencyKey = crypto.randomUUID();
  initializeTurnstile();
  show(0);
  if (revisionMode) {
    next.disabled = true;
    loadRevision()
      .then(() => { next.disabled = false; })
      .catch((loadError) => {
        error.textContent = loadError.message;
        form.querySelectorAll("input, textarea, select, button").forEach((control) => { control.disabled = true; });
      });
  }
})();
