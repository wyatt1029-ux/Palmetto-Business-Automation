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
  const turnstileContainer = document.querySelector("#turnstile-container");
  const config = window.PBA_OBSERVABILITY || {};
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

  const initializeTurnstile = () => {
    if (!config.turnstileSiteKey) {
      turnstileContainer.textContent = "Security verification is not configured.";
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      turnstileWidgetId = window.turnstile.render(turnstileContainer, {
        sitekey: config.turnstileSiteKey,
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
    try {
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Submission failed");
      document.querySelector("#customer-number").textContent = result.customerNumber;
      form.hidden = true;
      success.hidden = false;
    } catch {
      error.textContent = "I couldn’t send that yet. Please try again, or email hello@palmettobusinessautomation.com.";
      if (turnstileWidgetId !== null) window.turnstile?.reset(turnstileWidgetId);
      turnstileToken = "";
      next.disabled = false;
    }
  });

  back.addEventListener("click", () => show(current - 1));
  form.dataset.idempotencyKey = crypto.randomUUID();
  initializeTurnstile();
  show(0);
})();
