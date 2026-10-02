// Light/dark switch in the header. Dark is the default; the page head applies a stored choice before first paint.
(function themeToggle() {
  const root = document.documentElement;
  const button = document.querySelector(".theme-toggle");
  const label = () => {
    const next = root.dataset.theme === "light" ? "dark" : "light";
    button.setAttribute("aria-label", `Switch to ${next} theme`);
    button.title = `Switch to ${next} theme`;
  };
  label();
  button.addEventListener("click", () => {
    const light = root.dataset.theme !== "light";
    if (light) root.dataset.theme = "light";
    else delete root.dataset.theme;
    try {
      localStorage.setItem("mido-site-theme", light ? "light" : "dark");
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
    label();
  });
})();
