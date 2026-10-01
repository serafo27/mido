export type ThemeKind = "light" | "dark";

/** The colours a theme defines; everything else the UI needs is derived from them. */
export interface Palette {
  bg: string;
  sidebar: string;
  elevated: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  heading: string;
  accent: string;
  /** Secondary accent: quotes, dirty markers, folder icons. */
  warm: string;
  codeBg: string;
  codeFg: string;
  keyword: string;
  string: string;
  number: string;
  comment: string;
  function: string;
  type: string;
  attr: string;
}

export interface Theme {
  id: string;
  name: string;
  kind: ThemeKind;
  palette: Palette;
  custom?: boolean;
}

export const PALETTE_FIELDS: { key: keyof Palette; label: string; group: "Interface" | "Text" | "Code" }[] = [
  { key: "bg", label: "Background", group: "Interface" },
  { key: "sidebar", label: "Sidebar", group: "Interface" },
  { key: "elevated", label: "Panels", group: "Interface" },
  { key: "border", label: "Borders", group: "Interface" },
  { key: "accent", label: "Accent", group: "Interface" },
  { key: "warm", label: "Highlight", group: "Interface" },
  { key: "text", label: "Text", group: "Text" },
  { key: "heading", label: "Headings", group: "Text" },
  { key: "muted", label: "Muted", group: "Text" },
  { key: "faint", label: "Faint", group: "Text" },
  { key: "codeBg", label: "Code background", group: "Code" },
  { key: "codeFg", label: "Inline code", group: "Code" },
  { key: "keyword", label: "Keywords", group: "Code" },
  { key: "string", label: "Strings", group: "Code" },
  { key: "number", label: "Numbers", group: "Code" },
  { key: "comment", label: "Comments", group: "Code" },
  { key: "function", label: "Functions", group: "Code" },
  { key: "type", label: "Types", group: "Code" },
  { key: "attr", label: "Properties", group: "Code" },
];

const theme = (id: string, name: string, kind: ThemeKind, palette: Palette): Theme => ({ id, name, kind, palette });

export const BUILTIN_THEMES: Theme[] = [
  theme("mido-light", "Mido Light", "light", {
    bg: "#fbfaf7", sidebar: "#f2f0ea", elevated: "#ffffff", border: "#e4e0d6",
    text: "#25221d", muted: "#6d685f", faint: "#a29d92", heading: "#1d1b17",
    accent: "#2d6a5f", warm: "#d98a3d", codeBg: "#f4f1ea", codeFg: "#8a3f5f",
    keyword: "#9b3f6b", string: "#3d7a40", number: "#b0590a", comment: "#9c968b",
    function: "#2a5d8f", type: "#2d6a5f", attr: "#8a6a17",
  }),
  theme("mido-dark", "Mido Dark", "dark", {
    bg: "#17181a", sidebar: "#1e1f22", elevated: "#26272b", border: "#2f3135",
    text: "#e6e2d9", muted: "#a09b91", faint: "#69655e", heading: "#f3efe6",
    accent: "#6cc3b0", warm: "#e0a15f", codeBg: "#1f2023", codeFg: "#e4a3c1",
    keyword: "#e39cc0", string: "#a8d08d", number: "#f0aa6b", comment: "#6e6a63",
    function: "#8fbdea", type: "#6cc3b0", attr: "#e5c47d",
  }),
  theme("vscode-light", "VS Code Light+", "light", {
    bg: "#ffffff", sidebar: "#f3f3f3", elevated: "#ffffff", border: "#e5e5e5",
    text: "#1f1f1f", muted: "#616161", faint: "#a0a0a0", heading: "#1f1f1f",
    accent: "#005fb8", warm: "#a31515", codeBg: "#f3f3f3", codeFg: "#a31515",
    keyword: "#0000ff", string: "#a31515", number: "#098658", comment: "#008000",
    function: "#795e26", type: "#267f99", attr: "#001080",
  }),
  theme("vscode-dark", "VS Code Dark+", "dark", {
    bg: "#1e1e1e", sidebar: "#252526", elevated: "#2d2d30", border: "#3c3c3c",
    text: "#d4d4d4", muted: "#9d9d9d", faint: "#6a6a6a", heading: "#ffffff",
    accent: "#3794ff", warm: "#ce9178", codeBg: "#2b2b2b", codeFg: "#ce9178",
    keyword: "#569cd6", string: "#ce9178", number: "#b5cea8", comment: "#6a9955",
    function: "#dcdcaa", type: "#4ec9b0", attr: "#9cdcfe",
  }),
  theme("intellij-light", "IntelliJ Light", "light", {
    bg: "#ffffff", sidebar: "#f7f8fa", elevated: "#ffffff", border: "#ebecf0",
    text: "#080808", muted: "#6c707e", faint: "#a8adbd", heading: "#080808",
    accent: "#3574f0", warm: "#c77d2e", codeBg: "#f5f7fa", codeFg: "#067d17",
    keyword: "#0033b3", string: "#067d17", number: "#1750eb", comment: "#8c8c8c",
    function: "#00627a", type: "#008080", attr: "#871094",
  }),
  theme("intellij-darcula", "IntelliJ Darcula", "dark", {
    bg: "#2b2b2b", sidebar: "#3c3f41", elevated: "#3c3f41", border: "#4b4d4f",
    text: "#a9b7c6", muted: "#8c8c8c", faint: "#606366", heading: "#d4d8dd",
    accent: "#589df6", warm: "#cc7832", codeBg: "#313335", codeFg: "#6a8759",
    keyword: "#cc7832", string: "#6a8759", number: "#6897bb", comment: "#808080",
    function: "#ffc66d", type: "#bbb529", attr: "#9876aa",
  }),
  theme("relax", "Relax", "light", {
    bg: "#f4ecd8", sidebar: "#ebe1c8", elevated: "#faf4e6", border: "#dccfb0",
    text: "#4a3f2e", muted: "#7d6f58", faint: "#ab9c80", heading: "#3b3122",
    accent: "#6f8a58", warm: "#c08a4e", codeBg: "#ece2c9", codeFg: "#9a5b3a",
    keyword: "#9b5f7a", string: "#6b7f3e", number: "#b26a2e", comment: "#a3957a",
    function: "#4f6f8f", type: "#5f7f6a", attr: "#8f6f3a",
  }),
  theme("relax-night", "Relax Night", "dark", {
    bg: "#262422", sidebar: "#2e2b28", elevated: "#36332f", border: "#3f3b36",
    text: "#d8cfc0", muted: "#a39a8b", faint: "#6f675c", heading: "#eae1d1",
    accent: "#9fb58a", warm: "#d9a066", codeBg: "#2e2b28", codeFg: "#d9a38a",
    keyword: "#d4a0b4", string: "#aebf85", number: "#e0ae7a", comment: "#7a7266",
    function: "#9fb8d0", type: "#9fc4a8", attr: "#d9c08a",
  }),
  theme("solarized-light", "Solarized Light", "light", {
    bg: "#fdf6e3", sidebar: "#eee8d5", elevated: "#fdf6e3", border: "#e0d9c3",
    text: "#586e75", muted: "#839496", faint: "#93a1a1", heading: "#073642",
    accent: "#268bd2", warm: "#cb4b16", codeBg: "#eee8d5", codeFg: "#d33682",
    keyword: "#859900", string: "#2aa198", number: "#d33682", comment: "#93a1a1",
    function: "#268bd2", type: "#b58900", attr: "#cb4b16",
  }),
  theme("nord", "Nord", "dark", {
    bg: "#2e3440", sidebar: "#3b4252", elevated: "#434c5e", border: "#4c566a",
    text: "#d8dee9", muted: "#a3acbd", faint: "#6b7489", heading: "#eceff4",
    accent: "#88c0d0", warm: "#d08770", codeBg: "#3b4252", codeFg: "#ebcb8b",
    keyword: "#81a1c1", string: "#a3be8c", number: "#b48ead", comment: "#616e88",
    function: "#88c0d0", type: "#8fbcbb", attr: "#ebcb8b",
  }),
  theme("dracula", "Dracula", "dark", {
    bg: "#282a36", sidebar: "#21222c", elevated: "#343746", border: "#3a3c4e",
    text: "#f8f8f2", muted: "#bfbfd0", faint: "#6272a4", heading: "#ffffff",
    accent: "#bd93f9", warm: "#ffb86c", codeBg: "#21222c", codeFg: "#ff79c6",
    keyword: "#ff79c6", string: "#f1fa8c", number: "#bd93f9", comment: "#6272a4",
    function: "#50fa7b", type: "#8be9fd", attr: "#ffb86c",
  }),
];

export const DEFAULT_THEME: Record<ThemeKind, string> = { light: "mido-light", dark: "mido-dark" };

export function findTheme(id: string, custom: Theme[], kind: ThemeKind): Theme {
  return (
    custom.find((t) => t.id === id) ??
    BUILTIN_THEMES.find((t) => t.id === id) ??
    BUILTIN_THEMES.find((t) => t.id === DEFAULT_THEME[kind])!
  );
}

/** Semi-transparent version of a colour (any CSS colour, not just hex). */
const alpha = (color: string, amount: number) => `color-mix(in srgb, ${color} ${amount * 100}%, transparent)`;
const mix = (a: string, b: string, amountOfA: number) => `color-mix(in srgb, ${a} ${amountOfA * 100}%, ${b})`;

/** Expands a palette into the CSS variables used throughout the app. */
export function themeVariables(t: Theme, accentOverride?: string): Record<string, string> {
  const p = t.palette;
  const dark = t.kind === "dark";
  const accent = accentOverride ?? p.accent;
  return {
    "--bg": p.bg,
    "--bg-editor": mix(p.bg, p.elevated, 0.85),
    "--bg-sidebar": p.sidebar,
    "--bg-elev": p.elevated,
    "--bg-hover": alpha(p.text, dark ? 0.07 : 0.055),
    "--bg-active": alpha(accent, dark ? 0.16 : 0.13),
    "--border": p.border,
    "--border-soft": mix(p.border, p.bg, 0.6),
    "--text": p.text,
    "--text-muted": p.muted,
    "--text-faint": p.faint,
    "--accent": accent,
    "--accent-strong": mix(accent, p.text, 0.72),
    "--accent-soft": alpha(accent, dark ? 0.13 : 0.1),
    "--warm": p.warm,
    "--selection": alpha(accent, dark ? 0.26 : 0.2),
    "--active-line": alpha(p.text, dark ? 0.03 : 0.028),
    "--search-match": alpha(p.warm, 0.3),
    "--comment-highlight": alpha(p.warm, dark ? 0.06 : 0.05),
    "--comment-highlight-hover": alpha(p.warm, dark ? 0.18 : 0.15),
    "--comment-highlight-active": alpha(p.warm, dark ? 0.3 : 0.26),
    "--comment-underline": alpha(p.warm, dark ? 0.75 : 0.8),
    "--shadow": dark
      ? "0 12px 34px -8px rgba(0, 0, 0, 0.6), 0 2px 6px rgba(0, 0, 0, 0.3)"
      : "0 10px 30px -10px rgba(40, 30, 10, 0.25), 0 2px 6px rgba(40, 30, 10, 0.08)",
    "--md-heading": p.heading,
    "--code-bg": p.codeBg,
    "--code-fg": p.codeFg,
    "--quote-bg": alpha(p.warm, 0.07),
    "--table-stripe": alpha(p.text, 0.025),
    "--hl-keyword": p.keyword,
    "--hl-string": p.string,
    "--hl-number": p.number,
    "--hl-comment": p.comment,
    "--hl-title": p.function,
    "--hl-type": p.type,
    "--hl-attr": p.attr,
    "--hl-meta": p.muted,
  };
}

/** Parses a theme shared as JSON: `{ name, kind, colors | palette }`. Missing colours come from Mido. */
export function parseThemeJson(json: string): Theme {
  const data = JSON.parse(json) as { name?: unknown; kind?: unknown; colors?: unknown; palette?: unknown };
  const kind: ThemeKind = data.kind === "dark" ? "dark" : "light";
  const colors = (data.colors ?? data.palette ?? {}) as Record<string, unknown>;
  const base = findTheme(DEFAULT_THEME[kind], [], kind).palette;
  const palette = { ...base };
  for (const { key } of PALETTE_FIELDS) {
    if (typeof colors[key] === "string" && CSS.supports("color", colors[key] as string)) {
      palette[key] = colors[key] as string;
    }
  }
  return {
    id: `custom-${Date.now().toString(36)}`,
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Imported theme",
    kind,
    palette,
    custom: true,
  };
}

export function themeToJson(t: Theme): string {
  return JSON.stringify({ name: t.name, kind: t.kind, colors: t.palette }, null, 2);
}
