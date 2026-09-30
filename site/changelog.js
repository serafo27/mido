// Lists the published GitHub releases. Their notes come from CHANGELOG.md
// (the release workflow copies each version's section into its release), and
// GitHub renders the Markdown to sanitized HTML for us.
(async function changelog() {
  const REPO = "serafo27/mido";
  const container = document.getElementById("releases");

  const LABELS = [
    [/aarch64\.dmg$/i, "macOS · Apple Silicon"],
    [/x64\.dmg$/i, "macOS · Intel"],
  ];

  const escape = (text) =>
    text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let releases;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=50`, {
      // Ask GitHub for the release notes already rendered as HTML.
      headers: { Accept: "application/vnd.github.html+json" },
    });
    if (!response.ok) throw new Error(String(response.status));
    releases = (await response.json()).filter((r) => !r.draft);
  } catch {
    container.innerHTML = `<p class="releases-status">The changelog couldn't be loaded right now. You can read it on
      <a href="https://github.com/${REPO}/releases">GitHub</a>.</p>`;
    return;
  }

  if (releases.length === 0) {
    container.innerHTML = `<p class="releases-status">No version has been released yet — check back soon.</p>`;
    return;
  }

  container.innerHTML = releases
    .map((release, index) => {
      const version = release.tag_name.replace(/^v/, "");
      const date = new Date(release.published_at).toLocaleDateString("en", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const downloads = LABELS.map(([pattern, label]) => {
        const asset = release.assets.find((a) => pattern.test(a.name));
        return asset
          ? `<a class="button ${index === 0 ? "primary" : "secondary"} small" href="${asset.browser_download_url}">${label}</a>`
          : "";
      }).join("");

      return `
        <article class="release" id="v${escape(version)}">
          <header class="release-header">
            <h2><a href="#v${escape(version)}">${escape(version)}</a></h2>
            ${index === 0 ? '<span class="badge">Latest</span>' : ""}
            <time datetime="${release.published_at}">${date}</time>
          </header>
          <div class="release-notes">${release.body_html || "<p>No notes for this version.</p>"}</div>
          ${downloads ? `<div class="release-downloads">${downloads}</div>` : ""}
        </article>`;
    })
    .join("");

  // Honour a #vX.Y.Z link once the content exists.
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
})();
