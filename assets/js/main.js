const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const observability = {
  posthogKey: "019f874d-db97-0000-c57f-bd4a2c205abc",
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
  ((documentRef, posthog) => {
    if (posthog.__SV) return;

    window.posthog = posthog;
    posthog._i = [];
    posthog.init = (token, config, name) => {
      const script = documentRef.createElement("script");
      script.type = "text/javascript";
      script.crossOrigin = "anonymous";
      script.async = true;
      script.src = `${config.api_host.replace(".i.posthog.com", "-assets.i.posthog.com")}/static/array.js`;
      documentRef.head.appendChild(script);

      const instance = name ? (posthog[name] = []) : posthog;
      const methods =
        "init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug";

      instance.people = instance.people || [];
      methods.split(" ").forEach((method) => {
        instance[method] = (...args) => instance.push([method, ...args]);
      });
      posthog._i.push([token, config, name]);
    };
    posthog.__SV = 1;
  })(document, window.posthog || []);

  window.posthog.init(observability.posthogKey, {
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

    window.posthog.capture("site_link_clicked", {
      label: link.textContent.trim(),
      destination: link.getAttribute("href") || "",
    });
  });
}

const revealables = document.querySelectorAll(".reveal");

const topbar = document.querySelector(".topbar");
const topnav = document.querySelector(".topnav");

if (topbar && topnav) {
  const menuButton = document.createElement("button");
  const menuId = "primary-navigation";
  menuButton.className = "menu-button";
  menuButton.type = "button";
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-controls", menuId);
  menuButton.innerHTML = '<span aria-hidden="true"></span><span>Menu</span>';
  topnav.id = menuId;
  topbar.insertBefore(menuButton, topnav);

  const closeMenu = () => {
    topbar.classList.remove("menu-open");
    menuButton.setAttribute("aria-expanded", "false");
  };

  menuButton.addEventListener("click", () => {
    const isOpen = topbar.classList.toggle("menu-open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
      menuButton.focus();
    }
  });

  topnav.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });
}

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
