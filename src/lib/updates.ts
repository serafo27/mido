import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";

/**
 * Published releases, baked into the website at deploy time. Reading them from
 * there (instead of the GitHub API) avoids GitHub's per-IP rate limits.
 */
const RELEASES_URL = "https://serafo27.github.io/mido/releases.json";
export const CHANGELOG_URL = "https://serafo27.github.io/mido/changelog.html";

/** How often a running app checks again, in milliseconds. */
export const CHECK_INTERVAL = 12 * 60 * 60 * 1000;

interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface Release {
  tag_name: string;
  published_at: string;
  html_url: string;
  body_html: string;
  assets: ReleaseAsset[];
}

export interface UpdateInfo {
  currentVersion: string;
  version: string;
  publishedAt: string;
  notesHtml: string;
  /** Installer for this Mac's architecture, or the release page as a fallback. */
  downloadUrl: string;
  downloadSize?: number;
  changelogUrl: string;
}

export type UpdateCheck = { status: "up-to-date"; currentVersion: string } | ({ status: "available" } & UpdateInfo);

/** Compares dotted versions numerically ("0.10.0" > "0.9.3"); pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split("-")[0].split(".").map((n) => Number(n) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export async function checkForUpdates(): Promise<UpdateCheck> {
  const [currentVersion, arch] = await Promise.all([getVersion(), invoke<string>("app_arch")]);
  let response: Response;
  try {
    response = await fetch(`${RELEASES_URL}?t=${Date.now()}`, { cache: "no-store" });
  } catch {
    throw new Error("Mido couldn't reach the update server.");
  }
  if (!response.ok) throw new Error(`Couldn't reach the update server (HTTP ${response.status}).`);

  const releases = (await response.json()) as Release[];
  const latest = releases.find((r) => /^v?\d+\.\d+\.\d+$/.test(r.tag_name));
  if (!latest || compareVersions(latest.tag_name, currentVersion) <= 0) {
    return { status: "up-to-date", currentVersion };
  }

  const version = latest.tag_name.replace(/^v/, "");
  const dmgArch = arch === "aarch64" ? "aarch64" : "x64";
  const installer = latest.assets.find((a) => a.name.endsWith(`_${dmgArch}.dmg`));
  return {
    status: "available",
    currentVersion,
    version,
    publishedAt: latest.published_at,
    notesHtml: sanitizeNotes(latest.body_html),
    downloadUrl: installer?.browser_download_url ?? latest.html_url,
    downloadSize: installer?.size,
    changelogUrl: `${CHANGELOG_URL}#v${version}`,
  };
}

const ALLOWED_TAGS = new Set([
  "H1", "H2", "H3", "H4", "H5", "H6", "P", "UL", "OL", "LI", "STRONG", "B", "EM", "I",
  "CODE", "PRE", "A", "BR", "BLOCKQUOTE", "HR",
]);

/**
 * The notes are already sanitized by GitHub; this keeps only simple formatting
 * as a second line of defence, since they end up in the app's own window.
 */
function sanitizeNotes(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const clean = (node: Element) => {
    for (const child of [...node.children]) {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        clean(node);
        return;
      }
      for (const attr of [...child.attributes]) {
        const keep = child.tagName === "A" && attr.name === "href" && /^https:\/\//.test(attr.value);
        if (!keep) child.removeAttribute(attr.name);
      }
      clean(child);
    }
  };
  const root = doc.body.firstElementChild!;
  clean(root);
  return root.innerHTML;
}
