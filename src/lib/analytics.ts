import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { isEmbed, isWeb } from "./platform";
import type { Settings } from "./settings";
import { BUILTIN_THEMES, type Theme } from "./themes";

/**
 * Anonymous usage statistics, sent to PostHog (EU): how many people use Mido
 * each day on the desktop and on the web, with which theme, and whether they
 * use git and the terminal. Each thing is recorded at most once a day, and
 * never with file names, paths or contents. Off in Settings → Privacy.
 */

const CAPTURE_URL = "https://eu.i.posthog.com/i/v0/e/";
/**
 * The project's key, which can only send events. It comes from the release and
 * website builds (the POSTHOG_KEY secret), never from the repository: other
 * builds have none and send nothing.
 */
const PROJECT_KEY: string = import.meta.env.VITE_POSTHOG_KEY ?? "";

/** What is recorded once a day besides being active. */
export type Feature = "terminal" | "git-repo" | "source-control" | "git-commit" | "git-push" | "git-pull";

type Properties = Record<string, string | number | boolean>;

const DAYS_KEY = "mido.usageStats.days";
/** Also read by the site, on the same origin as the web version: a visit and later use count as one person. */
const ID_KEY = "mido.usageStats.id";

let enabled = false;

/** Follows the setting; nothing is sent until it's on. */
export function setUsageStats(on: boolean) {
  enabled = on;
}

/** Never from development, tests, or a web build previewed anywhere but the website. */
const canSend = () =>
  enabled &&
  PROJECT_KEY !== "" &&
  !import.meta.env.DEV &&
  // The host app speaks for itself.
  !isEmbed &&
  import.meta.env.MODE !== "test" &&
  (!isWeb || location.hostname === "serafo27.github.io");

const localDay = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** True the first time `name` is asked about on a given day, and remembers it. */
export function firstToday(name: string, storage: Storage = localStorage, now = new Date()): boolean {
  try {
    const days = JSON.parse(storage.getItem(DAYS_KEY) || "{}") as Record<string, string>;
    const today = localDay(now);
    if (days[name] === today) return false;
    storage.setItem(DAYS_KEY, JSON.stringify({ ...days, [name]: today }));
    return true;
  } catch {
    // Storage unavailable: don't record what can't be kept to once a day.
    return false;
  }
}

/** A built-in theme by name; people's own themes are only "custom". */
export const themeName = (id: string) => (BUILTIN_THEMES.some((t) => t.id === id) ? id : "custom");

/** The device, under the names PostHog's own library gives them, so its breakdowns work. */
export function deviceProperties(ua: string): Properties {
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "Mac OS X"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux|CrOS/.test(ua)
            ? "Linux"
            : "Other";
  const device = /iPad|Tablet/.test(ua) ? "Tablet" : /Mobi|iPhone|Android/.test(ua) ? "Mobile" : "Desktop";
  const props: Properties = { $os: os, $device_type: device };
  // The desktop app's web view names no browser.
  if (isWeb) {
    props.$browser = /Edg\//.test(ua)
      ? "Microsoft Edge"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Other";
  }
  return props;
}

/** A random id for this install or browser, so people are counted once rather than once a visit. */
function anonymousId(): string {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) localStorage.setItem(ID_KEY, (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function capture(event: string, properties: Properties) {
  const body = {
    api_key: PROJECT_KEY,
    event,
    distinct_id: anonymousId(),
    timestamp: new Date().toISOString(),
    properties: {
      ...deviceProperties(navigator.userAgent),
      platform: isWeb ? "web" : "desktop",
      $lib: "mido",
      $screen_width: screen.width,
      $screen_height: screen.height,
      // Anonymous events: PostHog keeps no profile of the person.
      $process_person_profile: false,
      ...properties,
    },
  };
  // Plain text, as PostHog's library sends it: no CORS preflight.
  fetch(CAPTURE_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}

/** Once a day: Mido was used, where, which version, and with which theme. */
export async function recordActiveDay(settings: Settings, theme: Theme) {
  if (!canSend() || !firstToday("active")) return;
  const properties: Properties = {
    version: await getVersion(),
    mode: settings.theme,
    theme: themeName(theme.id),
    lightTheme: themeName(settings.lightTheme),
    darkTheme: themeName(settings.darkTheme),
  };
  if (!isWeb) properties.arch = await invoke<string>("app_arch").catch(() => "unknown");
  capture("active", properties);
}

/** Once a day per feature: it was used. */
export function recordFeature(feature: Feature) {
  if (!canSend() || !firstToday(feature)) return;
  capture(feature, {});
}
