// Anonymous visit statistics, sent to PostHog (EU), as the app does
// (src/lib/analytics.ts): page views, and clicks on links marked data-track,
// with their data-track-* details. No cookies: a random id in this browser,
// shared with the web version of the app, which lives on the same origin.
(function () {
  const CAPTURE_URL = "https://eu.i.posthog.com/i/v0/e/";
  // Filled in when the site is deployed (.github/workflows/pages.yml), from the
  // POSTHOG_KEY secret: the key is never in the repository.
  const PROJECT_KEY = "__POSTHOG_KEY__";

  // Only the published site: not local previews.
  if (location.hostname !== "serafo27.github.io" || !PROJECT_KEY || PROJECT_KEY.startsWith("__")) return;

  function stored(storage, key, make) {
    try {
      let value = storage.getItem(key);
      if (!value) storage.setItem(key, (value = make()));
      return value;
    } catch {
      return make();
    }
  }

  /** A UUIDv7, which PostHog reads the session's start time from. */
  function uuidv7() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let ms = Date.now();
    for (let i = 5; i >= 0; i--, ms = Math.floor(ms / 256)) bytes[i] = ms % 256;
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  const distinctId = stored(localStorage, "mido.usageStats.id", () => crypto.randomUUID());
  const sessionId = stored(sessionStorage, "mido.usageStats.session", uuidv7);

  const ua = navigator.userAgent;
  const device = {
    $os: /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac OS X" : /Windows/.test(ua) ? "Windows" : /Linux|CrOS/.test(ua) ? "Linux" : "Other",
    $browser: /Edg\//.test(ua) ? "Microsoft Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other",
    $device_type: /iPad|Tablet/.test(ua) ? "Tablet" : /Mobi|iPhone|Android/.test(ua) ? "Mobile" : "Desktop",
  };

  function capture(event, properties) {
    const referrer = document.referrer;
    const body = {
      api_key: PROJECT_KEY,
      event,
      distinct_id: distinctId,
      timestamp: new Date().toISOString(),
      properties: {
        ...device,
        platform: "site",
        $lib: "mido-site",
        $current_url: location.href,
        $host: location.host,
        $pathname: location.pathname,
        $referrer: referrer || "$direct",
        $referring_domain: referrer ? new URL(referrer).host : "$direct",
        $session_id: sessionId,
        $screen_width: screen.width,
        $screen_height: screen.height,
        $process_person_profile: false,
        ...properties,
      },
    };
    // Plain text: no CORS preflight, and keepalive lets it finish as a download link leaves the page.
    fetch(CAPTURE_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  }

  capture("$pageview", {});

  document.addEventListener("click", (e) => {
    const link = e.target instanceof Element && e.target.closest("[data-track]");
    if (!link) return;
    const details = {};
    for (const [key, value] of Object.entries(link.dataset)) {
      if (key.startsWith("track") && key !== "track") details[key[5].toLowerCase() + key.slice(6)] = value;
    }
    capture(link.dataset.track, details);
  });
})();
