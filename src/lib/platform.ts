import { getCurrentWindow } from "@tauri-apps/api/window";

// No navigator outside a browser (the tests run in Node).
export const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
export const modKey = isMac ? "⌘" : "Ctrl";
export const altKey = isMac ? "⌥" : "Alt";

/** The read-only web version (built with vite.web.config.ts), rather than the desktop app. */
export const isWeb = import.meta.env.VITE_WEB === "1";

/**
 * Mido inside another app, a host (built with vite.embed.config.ts):
 * the host picks the folder and provides the terminal, so those stay out of Mido.
 */
export const isEmbed = import.meta.env.VITE_EMBED === "1";

/** Embedded with `?view=terminal`: only terminals, for a host's terminal panel (docs/embed.md). */
export const isEmbedTerminal = isEmbed && new URLSearchParams(location.search).get("view") === "terminal";

/** The desktop app's own terminal, git and updates: not in the web version, and the host's when embedded. */
export const hasTerminal = !isWeb && !isEmbed;
export const hasGit = !isWeb && !isEmbed;
export const hasUpdates = !isWeb && !isEmbed;

/** Whether this is the window Mido opens at launch, rather than one opened with New Window. The web version only has that one. */
export const isMainWindow = (() => {
  try {
    return getCurrentWindow().label === "main";
  } catch {
    // Not in a Tauri window (tests).
    return true;
  }
})();

/** What a floating window (src-tauri/src/floating.rs) holds, rather than the app. */
const floatingKind = (() => {
  try {
    const label = isWeb ? "" : getCurrentWindow().label;
    return label.startsWith("terminal-") ? "terminal" : label.startsWith("git-") ? "git" : null;
  } catch {
    return null;
  }
})();
export const isFloatingTerminal = floatingKind === "terminal";
/** A git dialog's window (commit, push): its label is `git-<dialog>-<n>`. */
export const isGitWindow = floatingKind === "git";

/** The desktop app on macOS draws its traffic lights over the top-left corner. */
export const macWindowInset = isMac && !isWeb && !isEmbed;

/** Why the web version can't open a remembered folder until it's clicked again. */
export const WEB_ACCESS_NEEDED = "Click the folder to let Mido read it again.";

/** The website's homepage, where the web version lives (at /app/). */
export const HOME_URL = "../";

/** Where the web version sends people for the desktop app. */
export const DOWNLOAD_URL = "https://serafo27.github.io/mido/#download";

/**
 * In the web version, asks for the desktop app instead of doing `feature`,
 * and returns true. In the desktop app, returns false: go ahead.
 */
export function requireDesktop(feature: string): boolean {
  if (!isWeb) return false;
  window.dispatchEvent(new CustomEvent("mido:desktop-only", { detail: feature }));
  return true;
}
