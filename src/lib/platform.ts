export const isMac = navigator.userAgent.includes("Mac");
export const modKey = isMac ? "⌘" : "Ctrl";
export const altKey = isMac ? "⌥" : "Alt";

/** The read-only web version (built with vite.web.config.ts), rather than the desktop app. */
export const isWeb = import.meta.env.VITE_WEB === "1";

/** The desktop app on macOS draws its traffic lights over the top-left corner. */
export const macWindowInset = isMac && !isWeb;

/** Why the web version can't open a remembered folder until it's clicked again. */
export const WEB_ACCESS_NEEDED = "Click the folder to let Mido read it again.";

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
