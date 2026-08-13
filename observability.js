(function initializeObservability() {
  const config = window.PBA_OBSERVABILITY || {};
  const isLocalPreview = ["", "localhost", "127.0.0.1"].includes(window.location.hostname);
  const sensitivePage = ["/intake.html", "/sow.html", "/payment.html"]
    .some((path) => window.location.pathname.endsWith(path));
  const loadScript = (source, options = {}) =>
    new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = source;
      script.async = true;
      if (options.crossOrigin) script.crossOrigin = options.crossOrigin;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });

  if (config.posthogKey && !isLocalPreview && !sensitivePage) {
    loadScript(`${config.posthogHost || "https://us.i.posthog.com"}/static/array.js`)
      .then(() => {
        window.posthog?.init(config.posthogKey, {
          api_host: config.posthogHost || "https://us.i.posthog.com",
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: true,
          disable_session_recording: true,
          defaults: "2026-05-30",
          persistence: "localStorage+cookie",
        });
        window.posthog?.capture("$pageview", {
          $current_url: `${window.location.origin}${window.location.pathname}`,
        });

        document.addEventListener("click", (event) => {
          const link = event.target.closest("a");
          if (!link) return;
          window.posthog?.capture("showcase_link_clicked", {
            label: link.textContent.trim(),
            destination: link.getAttribute("href") || "",
          });
        });
      })
      .catch(() => {});
  }

  // Sentry's project-specific loader provides the public DSN and default setup.
  if (config.sentryLoaderUrl && !isLocalPreview && !sensitivePage) {
    loadScript(config.sentryLoaderUrl, { crossOrigin: "anonymous" }).catch(() => {});
  }
})();
