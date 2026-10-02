import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { emit, listen } from "@tauri-apps/api/event";
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

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

/**
 * Downloads the update and puts it in place of the installed app, reporting
 * the progress as a fraction (null while the size is unknown). Mido downloads
 * it itself, so macOS doesn't quarantine it and it opens without the warning
 * an unsigned app downloaded in the browser gets. Resolves to false if the
 * release has no update for this app (e.g. a release from before the
 * updater): the installer has to be downloaded instead.
 */
export async function installUpdate(onProgress: (fraction: number | null) => void): Promise<boolean> {
  const update = await check();
  if (!update) return false;
  let total = 0;
  let received = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      onProgress(total ? 0 : null);
    } else if (event.event === "Progress") {
      received += event.data.chunkLength;
      onProgress(total ? Math.min(received / total, 1) : null);
    } else {
      onProgress(1);
    }
  });
  return true;
}

/** Asks every window to save its edits before a restart; each answers with `RESTART_READY`. */
export const PREPARE_RESTART = "prepare-restart";
export const RESTART_READY = "restart-ready";
export interface RestartReady {
  label: string;
  /** False if something is still unsaved (a save failed or was cancelled). */
  saved: boolean;
}

/** Restarts Mido once every window has saved its edits; throws, without restarting, if one couldn't. */
export async function restartWhenSaved(): Promise<void> {
  const labels = (await getAllWebviewWindows()).map((w) => w.label);
  const replies = new Map<string, boolean>();
  let allReplied = () => {};
  const done = new Promise<void>((resolve) => (allReplied = resolve));
  const unlisten = await listen<RestartReady>(RESTART_READY, ({ payload }) => {
    replies.set(payload.label, payload.saved);
    if (labels.every((l) => replies.has(l))) allReplied();
  });
  try {
    await emit(PREPARE_RESTART);
    // A save can ask what to do about a conflict: leave time to answer.
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 120_000))]);
  } finally {
    unlisten();
  }
  if (!labels.every((l) => replies.get(l))) {
    throw new Error("Some changes couldn't be saved. Save them, then choose Restart again.");
  }
  await relaunch();
}

const ALLOWED_TAGS = new Set([
  "H1", "H2", "H3", "H4", "H5", "H6", "P", "UL", "OL", "LI", "STRONG", "B", "EM", "I",
  "CODE", "PRE", "A", "BR", "BLOCKQUOTE", "HR",
]);

/**
 * The notes are already sanitized by GitHub; this keeps only simple formatting
 * as a second line of defence, since they end up in the app's own window.
 */
export function sanitizeNotes(html: string): string {
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
