const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const observability = {
  posthogKey: "",
  posthogHost: "https://us.i.posthog.com",
  sentryLoaderUrl: "https://js.sentry-cdn.com/b616f87b26a35459442eb57b47da1a05.min.js",
};

const isLocalPreview = ["", "localhost", "127.0.0.1"].includes(window.location.hostname);

const loadObservabilityScript = (source, options = {}) =>
  new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.async = true;
    if (options.crossOrigin) script.crossOrigin = options.crossOrigin;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });

if (!isLocalPreview && observability.sentryLoaderUrl) {
  loadObservabilityScript(observability.sentryLoaderUrl, { crossOrigin: "anonymous" }).catch(() => {});
}

if (!isLocalPreview && observability.posthogKey) {
  loadObservabilityScript(`${observability.posthogHost}/static/array.js`)
    .then(() => {
      window.posthog?.init(observability.posthogKey, {
        api_host: observability.posthogHost,
        capture_pageview: true,
        capture_pageleave: true,
        defaults: "2026-05-30",
        persistence: "localStorage+cookie",
      });

      document.addEventListener("click", (event) => {
        if (!(event.target instanceof Element)) return;
        const link = event.target.closest("a");
        if (!link) return;

        window.posthog?.capture("site_link_clicked", {
          label: link.textContent.trim(),
          destination: link.getAttribute("href") || "",
        });
      });
    })
    .catch(() => {});
}

const revealables = document.querySelectorAll(".reveal");

if (!prefersReducedMotion && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.18,
      rootMargin: "0px 0px -10% 0px",
    }
  );

  revealables.forEach((element) => observer.observe(element));
} else {
  revealables.forEach((element) => element.classList.add("is-visible"));
}

const heroVisual = document.querySelector(".hero-visual");
const stageFrame = document.querySelector(".stage-frame");

if (!prefersReducedMotion && heroVisual && stageFrame) {
  const maxShift = 10;

  heroVisual.addEventListener("pointermove", (event) => {
    const bounds = heroVisual.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;

    stageFrame.style.setProperty("--mx", `${x * maxShift}px`);
    stageFrame.style.setProperty("--my", `${y * maxShift}px`);
  });

  heroVisual.addEventListener("pointerleave", () => {
    stageFrame.style.setProperty("--mx", "0px");
    stageFrame.style.setProperty("--my", "0px");
  });
}
