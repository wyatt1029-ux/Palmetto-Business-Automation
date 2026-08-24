if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

function resetHomeScroll() {
  if (window.location.pathname === "/" && !window.location.hash) {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }
}

window.addEventListener("pageshow", resetHomeScroll);
resetHomeScroll();

document.querySelectorAll("a[href^='#']").forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
