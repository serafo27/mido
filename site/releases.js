// Release data is baked into the site at deploy time as releases.json (see
// .github/workflows/pages.yml), so pages never call the rate-limited GitHub
// API from the visitor's browser. Newest release first.
window.MidoReleases = {
  REPO: "serafo27/mido",

  async load() {
    const response = await fetch("releases.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`releases.json: ${response.status}`);
    const releases = await response.json();
    if (!Array.isArray(releases)) throw new Error("releases.json: unexpected format");
    return releases;
  },

  version: (release) => release.tag_name.replace(/^v/, ""),

  date: (release) =>
    new Date(release.published_at).toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" }),

  size: (bytes) => `${(bytes / 1e6).toFixed(1)} MB`,

  /** The macOS installer for an architecture ("aarch64" or "x64"), if present. */
  dmg: (release, arch) => release.assets.find((a) => new RegExp(`_${arch}\\.dmg$`, "i").test(a.name)),
};
