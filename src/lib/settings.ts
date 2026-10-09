import { DEFAULT_THEME, findTheme, themeVariables, type Theme, type ThemeKind } from "./themes";
import { HOST_THEME_ID, hostTheme } from "./hostTheme";
import { isEmbed } from "./platform";

export type ThemePref = "system" | "light" | "dark";
/** "theme" uses the active theme's own accent. */
export type Accent = "theme" | "teal" | "blue" | "violet" | "rose" | "amber";
export type StylePreset = "mido" | "github" | "vscode" | "obsidian" | "notion" | "academic" | "minimal";
export type FontRole = "body" | "heading" | "code";
/** "classic": square tabs with dividers. "rounded": folder tabs with rounded tops. */
export type TabStyle = "classic" | "rounded";

/**
 * Which images from the internet documents may load, as in VS Code's
 * Markdown preview: loading one tells its server the document was opened.
 */
export type RemoteImages = "all" | "secure" | "none";

export interface Settings {
  theme: ThemePref;
  /** Theme used in light mode (and by "system" when the OS is light). */
  lightTheme: string;
  darkTheme: string;
  customThemes: Theme[];
  accent: Accent;
  /** Shows the current file's path in its own bar above the tabs. */
  showPathBar: boolean;
  style: StylePreset;
  bodyFont: string;
  headingFont: string;
  codeFont: string;
  customBodyFont: string;
  customHeadingFont: string;
  customCodeFont: string;
  fontSize: number;
  lineHeight: number;
  /** Max width of the reading column in px; 0 = fill the pane. */
  contentWidth: number;
  justify: boolean;
  showFrontmatter: boolean;
  editorFontSize: number;
  editorLineHeight: number;
  wrap: boolean;
  autosave: boolean;
  /** The writing tools over the editor in Edit mode and on the editor side of Split. */
  formatBar: boolean;
  /** Check for new versions at launch (and periodically) and offer them. */
  checkForUpdates: boolean;
  /** Name comments are signed with when git has no user. */
  commentAuthor: string;
  /** A minimap of the document in place of the scrollbar, in the editor and the preview. */
  minimap: boolean;
  remoteImages: RemoteImages;
  tabStyle: TabStyle;
  /** Source control lists every changed file and commit, not only Markdown documents. */
  gitShowAllFiles: boolean;
  /** An installed font for the terminal (a Nerd Font for a fancy prompt); empty: the system's, as in Terminal. */
  terminalFont: string;
  /** Anonymous usage statistics, once a day: see lib/analytics.ts. */
  usageStats: boolean;
  /** The assistant (a Pro feature, in progress): not in the settings panel yet. */
  aiChat: boolean;
  /** Where in the project the assistant writes its notes, and Save as Note saves. */
  aiFolder: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  lightTheme: DEFAULT_THEME.light,
  darkTheme: DEFAULT_THEME.dark,
  customThemes: [],
  accent: "amber",
  showPathBar: false,
  style: "github",
  bodyFont: "system",
  headingFont: "system",
  codeFont: "system-mono",
  customBodyFont: "",
  customHeadingFont: "",
  customCodeFont: "",
  fontSize: 14.5,
  lineHeight: 1.58,
  contentWidth: 1000,
  justify: false,
  showFrontmatter: true,
  editorFontSize: 14,
  editorLineHeight: 1.75,
  wrap: true,
  autosave: true,
  formatBar: true,
  checkForUpdates: true,
  commentAuthor: "",
  minimap: false,
  remoteImages: "secure",
  tabStyle: "rounded",
  gitShowAllFiles: false,
  terminalFont: "",
  usageStats: true,
  aiChat: false,
  aiFolder: "ai",
};

/**
 * The defaults up to 0.10, for the settings that have changed since. Only
 * what people change is stored, so without these, earlier installs would
 * switch to the new defaults; those are for new installs.
 */
const DEFAULTS_UP_TO_0_10: Partial<Settings> = {
  theme: "system",
  accent: "theme",
  showPathBar: true,
  style: "mido",
  bodyFont: "inter",
  headingFont: "source-serif",
  codeFont: "jetbrains",
  fontSize: 16,
  lineHeight: 1.72,
  contentWidth: 780,
  tabStyle: "classic",
};

const SETTINGS_KEY = "mido.settings";
/** Set once the stored settings are up to date with the defaults' changes. */
const DEFAULTS_VERSION_KEY = "mido.defaultsVersion";
const DEFAULTS_VERSION = 1;

/**
 * Keeps the old defaults for installs from before they changed, by storing
 * them as if chosen. Runs before the app reads its settings.
 */
export function migrateDefaults(storage: Storage = localStorage) {
  try {
    if (Number(storage.getItem(DEFAULTS_VERSION_KEY)) >= DEFAULTS_VERSION) return;
    // Every launch caches its theme, so an earlier install has one.
    if (storage.getItem("mido.themeCache") !== null) {
      const stored = JSON.parse(storage.getItem(SETTINGS_KEY) || "{}") as Partial<Settings>;
      storage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULTS_UP_TO_0_10, ...stored }));
    }
    storage.setItem(DEFAULTS_VERSION_KEY, String(DEFAULTS_VERSION));
  } catch {
    // Storage unavailable: nothing was stored to keep.
  }
}

export interface FontOption {
  id: string;
  label: string;
  css: string;
}

const SANS_FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const SERIF_FALLBACK = '"Iowan Old Style", Georgia, serif';
const MONO_FALLBACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export const FONTS: Record<"sans" | "serif" | "mono", FontOption[]> = {
  sans: [
    { id: "inter", label: "Inter", css: `"Inter Variable", ${SANS_FALLBACK}` },
    { id: "plex", label: "IBM Plex Sans", css: `"IBM Plex Sans Variable", ${SANS_FALLBACK}` },
    { id: "system", label: "System", css: SANS_FALLBACK },
  ],
  serif: [
    { id: "source-serif", label: "Source Serif", css: `"Source Serif 4 Variable", ${SERIF_FALLBACK}` },
    { id: "literata", label: "Literata", css: `"Literata Variable", ${SERIF_FALLBACK}` },
    { id: "system-serif", label: "System Serif", css: `ui-serif, ${SERIF_FALLBACK}` },
  ],
  mono: [
    { id: "jetbrains", label: "JetBrains Mono", css: `"JetBrains Mono Variable", ${MONO_FALLBACK}` },
    { id: "fira", label: "Fira Code", css: `"Fira Code Variable", ${MONO_FALLBACK}` },
    { id: "system-mono", label: "System Mono", css: MONO_FALLBACK },
  ],
};

export const FONT_CHOICES: Record<FontRole, FontOption[]> = {
  body: [...FONTS.sans, ...FONTS.serif],
  heading: [...FONTS.serif, ...FONTS.sans],
  code: FONTS.mono,
};

const ALL_FONTS = [...FONTS.sans, ...FONTS.serif, ...FONTS.mono];

function fontCss(id: string, custom: string, fallback: string): string {
  if (id === "custom" && custom.trim()) return `"${custom.trim().replace(/"/g, "")}", ${fallback}`;
  return ALL_FONTS.find((f) => f.id === id)?.css ?? fallback;
}

/** The terminal's font: the one named, then the system's monospaced font, as Terminal uses. */
export const terminalFontCss = (name: string) => fontCss("custom", name, MONO_FALLBACK);

export interface PresetInfo {
  id: StylePreset;
  label: string;
  description: string;
  fonts: Pick<Settings, "bodyFont" | "headingFont" | "codeFont" | "justify">;
}

export const PRESETS: PresetInfo[] = [
  {
    id: "mido",
    label: "Mido",
    description: "Warm and editorial",
    fonts: { bodyFont: "inter", headingFont: "source-serif", codeFont: "jetbrains", justify: false },
  },
  {
    id: "github",
    label: "GitHub",
    description: "As on github.com",
    fonts: { bodyFont: "system", headingFont: "system", codeFont: "system-mono", justify: false },
  },
  {
    id: "vscode",
    label: "VS Code",
    description: "As in its preview",
    fonts: { bodyFont: "system", headingFont: "system", codeFont: "system-mono", justify: false },
  },
  {
    id: "obsidian",
    label: "Obsidian",
    description: "As in its reading view",
    fonts: { bodyFont: "system", headingFont: "system", codeFont: "system-mono", justify: false },
  },
  {
    id: "notion",
    label: "Notion",
    description: "As a Notion page",
    fonts: { bodyFont: "system", headingFont: "system", codeFont: "system-mono", justify: false },
  },
  {
    id: "academic",
    label: "Academic",
    description: "Book-like serif",
    fonts: { bodyFont: "literata", headingFont: "literata", codeFont: "jetbrains", justify: true },
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Quiet and airy",
    fonts: { bodyFont: "plex", headingFont: "plex", codeFont: "fira", justify: false },
  },
];

export const ACCENTS: { id: Exclude<Accent, "theme">; label: string; light: string; dark: string }[] = [
  { id: "teal", label: "Teal", light: "#2d6a5f", dark: "#6cc3b0" },
  { id: "blue", label: "Blue", light: "#2f64b3", dark: "#7aa9ec" },
  { id: "violet", label: "Violet", light: "#6b4bb3", dark: "#b39ae8" },
  { id: "rose", label: "Rose", light: "#b0445f", dark: "#ec8fa6" },
  { id: "amber", label: "Amber", light: "#a8621a", dark: "#e8a860" },
];

/** The theme shown right now, given the OS appearance. */
export function activeTheme(settings: Settings, systemDark: boolean): Theme {
  // Embedded, the host's theme is the only one (once it has sent it).
  const host = isEmbed ? hostTheme() : null;
  if (host) return host;
  const kind: ThemeKind = settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;
  return findTheme(kind === "dark" ? settings.darkTheme : settings.lightTheme, settings.customThemes, kind);
}

export function fontFor(settings: Settings, role: FontRole): string {
  switch (role) {
    case "body":
      return fontCss(settings.bodyFont, settings.customBodyFont, SANS_FALLBACK);
    case "heading":
      return fontCss(settings.headingFont, settings.customHeadingFont, SERIF_FALLBACK);
    case "code":
      return fontCss(settings.codeFont, settings.customCodeFont, MONO_FALLBACK);
  }
}

/** Variables of the light theme in use, for printing: paper is light whatever the app shows. */
export function lightThemeVariables(settings: Settings): Record<string, string> {
  const theme = activeTheme({ ...settings, theme: "light" }, false);
  const accent = ACCENTS.find((a) => a.id === settings.accent)?.light;
  return themeVariables(theme, accent);
}

let appliedThemeVars: string[] = [];

/** Exposes the theme and reading settings as CSS variables on the document root. */
export function applySettings(settings: Settings, systemDark: boolean) {
  const root = document.documentElement;
  const theme = activeTheme(settings, systemDark);
  // The host's theme comes with its own accent.
  const accent = theme.id === HOST_THEME_ID ? undefined : ACCENTS.find((a) => a.id === settings.accent)?.[theme.kind];
  const themeVars = themeVariables(theme, accent);

  root.dataset.theme = theme.kind;
  root.dataset.style = settings.style;
  root.dataset.tabs = settings.tabStyle;
  for (const k of appliedThemeVars) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(themeVars)) root.style.setProperty(k, v);
  appliedThemeVars = Object.keys(themeVars);
  try {
    // Lets index.html paint the right colours before the app loads.
    localStorage.setItem("mido.themeCache", JSON.stringify({ kind: theme.kind, vars: themeVars }));
  } catch {
    // Storage unavailable: only the first paint is affected.
  }

  const vars: Record<string, string> = {
    "--md-font-body": fontFor(settings, "body"),
    "--md-font-heading": fontFor(settings, "heading"),
    "--md-font-code": fontFor(settings, "code"),
    "--md-font-size": `${settings.fontSize}px`,
    "--md-line-height": String(settings.lineHeight),
    "--md-width": settings.contentWidth ? `${settings.contentWidth}px` : "none",
    "--editor-font-size": `${settings.editorFontSize}px`,
    "--editor-line-height": String(settings.editorLineHeight),
    "--terminal-font": terminalFontCss(settings.terminalFont),
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

/** Whether `src` is an image from the internet that `policy` doesn't load. */
/** The text sizes' ranges, as Settings offers them. */
export const TEXT_SIZE = { min: 13, max: 24 };
export const EDITOR_FONT_SIZE = { min: 11, max: 22 };
export const LINE_HEIGHT = { min: 1.3, max: 2.2 };
export const EDITOR_LINE_HEIGHT = { min: 1.3, max: 2.4 };
const LINE_HEIGHT_STEP = 0.1;

/**
 * Both text sizes (the document's and the editor's) `steps` pixels bigger
 * or smaller, within their ranges; 0 steps puts them back to the defaults.
 */
export function zoomText(settings: Settings, steps: number): Pick<Settings, "fontSize" | "editorFontSize"> {
  if (steps === 0) return { fontSize: DEFAULT_SETTINGS.fontSize, editorFontSize: DEFAULT_SETTINGS.editorFontSize };
  const clamp = (v: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, v));
  return {
    fontSize: clamp(settings.fontSize + steps, TEXT_SIZE),
    editorFontSize: clamp(settings.editorFontSize + steps, EDITOR_FONT_SIZE),
  };
}

/** A terminal's own text size: ⌘+ and ⌘− on it move it away from the editor's, which it otherwise follows. */
export const TERMINAL_FONT_SIZE = { min: 8, max: 32 };

/** The size a terminal shows: the editor's (`base`) plus its own `offset`, within range. */
export const terminalFontSize = (base: number, offset: number) =>
  Math.min(TERMINAL_FONT_SIZE.max, Math.max(TERMINAL_FONT_SIZE.min, base + offset));

/** A terminal's offset `steps` pixels bigger or smaller, within range; 0 steps back to the editor's size. */
export function zoomTerminal(base: number, offset: number, steps: number): number {
  return steps === 0 ? 0 : terminalFontSize(base, terminalFontSize(base, offset) - base + steps) - base;
}

/**
 * Both line heights (the document's and the editor's) `steps` tenths more
 * or less, within their ranges.
 */
export function spaceLines(settings: Settings, steps: number): Pick<Settings, "lineHeight" | "editorLineHeight"> {
  const next = (v: number, { min, max }: { min: number; max: number }) =>
    Math.round(Math.min(max, Math.max(min, v + steps * LINE_HEIGHT_STEP)) * 100) / 100;
  return {
    lineHeight: next(settings.lineHeight, LINE_HEIGHT),
    editorLineHeight: next(settings.editorLineHeight, EDITOR_LINE_HEIGHT),
  };
}

export function blocksImage(policy: RemoteImages, src: string): boolean {
  if (policy === "all") return false;
  // Protocol-relative URLs count as insecure: the app's own origin isn't https everywhere.
  if (/^(http:)?\/\//i.test(src)) return true;
  return policy === "none" && /^https:/i.test(src);
}
