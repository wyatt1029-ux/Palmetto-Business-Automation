const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  const maxShift = 18;

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
