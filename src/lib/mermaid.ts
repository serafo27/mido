import { useEffect, useMemo, useState } from "react";

type Mermaid = typeof import("mermaid").default;

/** How diagrams are coloured: Mermaid's base theme, with colours from the app's theme. */
export interface MermaidTheme {
  dark: boolean;
  /** Mermaid `themeVariables`; empty to use Mermaid's own default or dark theme. */
  variables: Record<string, string | boolean>;
}

const FONT = '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

type Rgb = [number, number, number];

let probe: CanvasRenderingContext2D | null | undefined;

/** Any CSS colour as RGB, as the browser reads it; null if it isn't one. */
function parseColor(css: string): Rgb | null {
  probe ??= document.createElement("canvas").getContext("2d");
  if (!probe || !css.trim()) return null;
  probe.fillStyle = "#010203";
  probe.fillStyle = css.trim();
  const value = String(probe.fillStyle);
  if (value === "#010203" && css.trim() !== "#010203") return null;
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
  const rgb = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(value);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

const toHex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
/** `amount` of `a` over `b`. */
const mix = (a: Rgb, b: Rgb, amount: number): Rgb => [0, 1, 2].map((i) => a[i] * amount + b[i] * (1 - amount)) as Rgb;

/**
 * Diagram colours from the app theme's variables (read with `get`): nodes
 * tinted with the accent, notes with the highlight colour, lines muted.
 */
export function mermaidTheme(get: (name: string) => string, dark: boolean): MermaidTheme {
  const names = ["--bg", "--text", "--text-muted", "--border", "--accent", "--warm", "--code-bg", "--md-heading"];
  const colors = names.map((name) => parseColor(get(name)));
  if (colors.some((c) => !c)) return { dark, variables: {} };
  const [bg, text, muted, border, accent, warm, codeBg, heading] = colors as Rgb[];
  const primary = toHex(mix(accent, bg, dark ? 0.24 : 0.14));
  const primaryBorder = toHex(mix(accent, bg, 0.7));
  const secondary = toHex(mix(warm, bg, dark ? 0.24 : 0.16));
  const secondaryBorder = toHex(mix(warm, bg, 0.7));
  return {
    dark,
    variables: {
      darkMode: dark,
      fontFamily: FONT,
      background: toHex(bg),
      textColor: toHex(text),
      titleColor: toHex(heading),
      lineColor: toHex(muted),
      primaryColor: primary,
      primaryTextColor: toHex(text),
      primaryBorderColor: primaryBorder,
      secondaryColor: secondary,
      secondaryTextColor: toHex(text),
      secondaryBorderColor: secondaryBorder,
      tertiaryColor: toHex(codeBg),
      tertiaryTextColor: toHex(text),
      tertiaryBorderColor: toHex(border),
      mainBkg: primary,
      nodeBorder: primaryBorder,
      clusterBkg: toHex(codeBg),
      clusterBorder: toHex(border),
      edgeLabelBackground: toHex(bg),
      noteBkgColor: secondary,
      noteTextColor: toHex(text),
      noteBorderColor: secondaryBorder,
      actorBkg: primary,
      actorBorder: primaryBorder,
      actorTextColor: toHex(text),
      actorLineColor: toHex(muted),
      signalColor: toHex(text),
      signalTextColor: toHex(text),
      labelBoxBkgColor: primary,
      labelBoxBorderColor: primaryBorder,
      labelTextColor: toHex(text),
      loopTextColor: toHex(text),
    },
  };
}

/** The diagram theme for what the app shows now. */
export function currentMermaidTheme(): MermaidTheme {
  const style = getComputedStyle(document.documentElement);
  return mermaidTheme((name) => style.getPropertyValue(name), document.documentElement.dataset.theme === "dark");
}

// Mermaid is large, so it's only loaded once a document has a diagram.
let loading: Promise<Mermaid> | null = null;
let configuredTheme: string | null = null;
let counter = 0;
// Mermaid's configuration is global: render one diagram at a time.
let queue: Promise<unknown> = Promise.resolve();

const cache = new Map<string, string>();
const CACHE_SIZE = 100;

/** Renders a Mermaid diagram to SVG markup. Rejects with Mermaid's message on a syntax error. */
export function renderMermaid(code: string, theme: MermaidTheme): Promise<string> {
  const themeKey = JSON.stringify(theme);
  const key = `${themeKey}\n${code}`;
  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);

  const job = queue.then(async () => {
    loading ??= import("mermaid").then((m) => m.default);
    const mermaid = await loading;
    if (configuredTheme !== themeKey) {
      const custom = Object.keys(theme.variables).length > 0;
      mermaid.initialize({
        startOnLoad: false,
        // Escapes labels and drops click handlers: diagrams come from untrusted files.
        securityLevel: "strict",
        theme: custom ? "base" : theme.dark ? "dark" : "default",
        themeVariables: custom ? theme.variables : undefined,
        fontFamily: FONT,
      });
      configuredTheme = themeKey;
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

/** The diagram theme for what the app shows, following theme changes. */
export function useMermaidTheme(): MermaidTheme {
  const read = () => JSON.stringify(currentMermaidTheme());
  const [key, setKey] = useState(read);
  useEffect(() => {
    // Themes set data-theme (light or dark) and their colours as inline variables.
    const observer = new MutationObserver(() => setKey(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    return () => observer.disconnect();
  }, []);
  return useMemo(() => JSON.parse(key) as MermaidTheme, [key]);
}
