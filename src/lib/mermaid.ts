import { useEffect, useState } from "react";

type Mermaid = typeof import("mermaid").default;

// Mermaid is large, so it's only loaded once a document has a diagram.
let loading: Promise<Mermaid> | null = null;
let configuredTheme: string | null = null;
let counter = 0;
// Mermaid's configuration is global: render one diagram at a time.
let queue: Promise<unknown> = Promise.resolve();

const cache = new Map<string, string>();
const CACHE_SIZE = 100;

/** Renders a Mermaid diagram to SVG markup. Rejects with Mermaid's message on a syntax error. */
export function renderMermaid(code: string, dark: boolean): Promise<string> {
  const key = `${dark ? "dark" : "light"}\n${code}`;
  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);

  const job = queue.then(async () => {
    loading ??= import("mermaid").then((m) => m.default);
    const mermaid = await loading;
    const theme = dark ? "dark" : "default";
    if (configuredTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        // Escapes labels and drops click handlers: diagrams come from untrusted files.
        securityLevel: "strict",
        theme,
        fontFamily: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      });
      configuredTheme = theme;
    }
    const id = `mido-mermaid-${++counter}`;
    try {
      const { svg } = await mermaid.render(id, code);
      if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
      cache.set(key, svg);
      return svg;
    } finally {
      // On errors Mermaid can leave its scratch element in the page.
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  });
  queue = job.catch(() => {});
  return job;
}

/** Whether the app is showing a dark theme, following theme changes. */
export function useDarkTheme(): boolean {
  const read = () => document.documentElement.dataset.theme === "dark";
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}
