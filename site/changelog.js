// Lists the published releases. Their notes come from CHANGELOG.md (the release
// workflow copies each version's section into its release); GitHub renders the
// Markdown to sanitized HTML, which the Pages workflow bakes into releases.json.
(async function changelog() {
  const REPO = window.MidoReleases.REPO;
  const container = document.getElementById("releases");

  const LABELS = [
    [/aarch64\.dmg$/i, "macOS · Apple Silicon"],
    [/x64\.dmg$/i, "macOS · Intel"],
  ];

  const escape = (text) =>
    text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let releases;
  try {
    releases = await window.MidoReleases.load();
  } catch {
    container.innerHTML = `<p class="releases-status">The changelog couldn't be loaded right now. You can read it on
      <a href="https://github.com/${REPO}/releases">GitHub</a>.</p>`;
    return;
  }

  if (releases.length === 0) {
    container.innerHTML = `<p class="releases-status">No version has been released yet — check back soon.</p>`;
    return;
  }

  const render = (release, index) => {
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
  };

  // The latest versions first; older ones a few at a time, when asked for.
  const FIRST = 3;
  const MORE = 5;
  let shown = 0;
  container.innerHTML = "";
  const more = document.createElement("div");
  more.className = "releases-more";
  more.innerHTML = '<button type="button" class="button secondary small"></button>';
  container.after(more);
  const button = more.querySelector("button");

  const showUpTo = (count) => {
    const next = Math.min(count, releases.length);
    if (next <= shown) return;
    container.insertAdjacentHTML("beforeend", releases.slice(shown, next).map((r, i) => render(r, shown + i)).join(""));
    shown = next;
    const left = releases.length - shown;
    more.hidden = left === 0;
    button.textContent = `Show ${Math.min(left, MORE)} older ${Math.min(left, MORE) === 1 ? "version" : "versions"}`;
  };
  button.addEventListener("click", () => showUpTo(shown + MORE));

  // A #vX.Y.Z link shows every version down to that one, then goes to it.
  const reveal = () => {
    const index = releases.findIndex((r) => `#v${r.tag_name.replace(/^v/, "")}` === location.hash);
    showUpTo(Math.max(FIRST, index + 1));
    if (index !== -1) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  };
  reveal();
  window.addEventListener("hashchange", reveal);
})();
