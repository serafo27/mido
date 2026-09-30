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

// Downloads: link each button to the matching asset of the latest GitHub release.
(async function downloads() {
  const REPO = "serafo27/mido";
  const RELEASES = `https://github.com/${REPO}/releases`;

  const PATTERNS = {
    "mac-arm": /aarch64\.dmg$/i,
    "mac-intel": /x64\.dmg$/i,
    "win-exe": /setup\.exe$/i,
    "win-msi": /\.msi$/i,
    "linux-appimage": /\.AppImage$/i,
    "linux-deb": /\.deb$/i,
    "linux-rpm": /\.rpm$/i,
  };
  const PRIMARY = { mac: "mac-arm", windows: "win-exe", linux: "linux-appimage" };
  const LABELS = { mac: "Download for macOS", windows: "Download for Windows", linux: "Download for Linux" };

  const detectPlatform = () => {
    const platform = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent).toLowerCase();
    if (platform.includes("mac")) return "mac";
    if (platform.includes("win")) return "windows";
    if (platform.includes("linux") && !/android/i.test(navigator.userAgent)) return "linux";
    return null;
  };

  const os = detectPlatform();
  const heroButton = document.getElementById("hero-download");
  const heroLabel = document.getElementById("hero-download-label");
  const heroNote = document.getElementById("hero-note");
  const info = document.getElementById("release-info");

  if (os) {
    heroLabel.textContent = LABELS[os];
    document.querySelector(`.platform[data-platform="${os}"]`)?.classList.add("current");
  }

  let release;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(String(response.status));
    release = await response.json();
  } catch {
    // No published release yet (or the API is unreachable): point at the releases page.
    info.innerHTML = `Installers will appear on the <a href="${RELEASES}">releases page</a> with the first release.`;
    heroButton.href = "#download";
    return;
  }

  const version = release.tag_name.replace(/^v/, "");
  const date = new Date(release.published_at).toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" });
  info.innerHTML = `Version ${version} · released ${date} · <a href="${release.html_url}">release notes</a>`;
  heroNote.textContent = `Version ${version} · Free · Your files stay plain Markdown on your disk`;

  const urls = {};
  for (const [key, pattern] of Object.entries(PATTERNS)) {
    const asset = release.assets.find((a) => pattern.test(a.name));
    if (asset) urls[key] = asset.browser_download_url;
  }

  document.querySelectorAll("[data-asset]").forEach((link) => {
    const url = urls[link.dataset.asset];
    if (url) link.href = url;
    else link.href = release.html_url;
  });

  if (os && urls[PRIMARY[os]]) heroButton.href = urls[PRIMARY[os]];
})();
