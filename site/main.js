// Theme switcher: swaps the large screenshot.
(function themes() {
  const image = document.getElementById("theme-image");
  const tabs = document.querySelectorAll(".theme-tabs button");
  // Warm the cache so switching is instant.
  tabs.forEach((tab) => {
    new Image().src = `assets/screens/${tab.dataset.shot}.webp`;
  });
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      image.classList.add("fading");
      const next = new Image();
      next.onload = () => {
        image.src = next.src;
        image.alt = `Mido with the ${tab.textContent} theme`;
        image.classList.remove("fading");
      };
      next.src = `assets/screens/${tab.dataset.shot}.webp`;
    });
  });
})();

// Downloads: point each button straight at its installer in the latest release.
(async function downloads() {
  const R = window.MidoReleases;
  const heroNote = document.getElementById("hero-note");
  const info = document.getElementById("release-info");

  let release;
  try {
    release = (await R.load())[0];
  } catch {
    // Not deployed through the Pages workflow (e.g. a local preview).
  }
  if (!release) {
    info.innerHTML = `Installers will appear on the <a href="https://github.com/${R.REPO}/releases">releases page</a> with the first release.`;
    return;
  }

  const version = R.version(release);
  const changelog = `changelog.html#v${version}`;
  info.textContent = `Version ${version} · released ${R.date(release)}`;
  heroNote.textContent = `Version ${version} · Free · Your files stay plain Markdown on your disk`;

  const badge = document.getElementById("release-version");
  badge.textContent = `v${version}`;
  badge.hidden = false;

  const whatsNew = document.getElementById("whats-new");
  whatsNew.textContent = `What's new in ${version} →`;
  whatsNew.href = changelog;
  whatsNew.hidden = false;

  const assets = { "mac-arm": R.dmg(release, "aarch64"), "mac-intel": R.dmg(release, "x64") };
  document.querySelectorAll("[data-asset]").forEach((link) => {
    const asset = assets[link.dataset.asset];
    if (!asset) {
      link.href = release.html_url;
      return;
    }
    link.href = asset.browser_download_url;
    link.title = asset.name;
    link.querySelector(".asset-meta").textContent = `.dmg · ${R.size(asset.size)}`;
  });
})();
