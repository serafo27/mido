import { DEFAULT_THEME, findTheme, themeVariables, type Theme, type ThemeKind } from "./themes";

export type ThemePref = "system" | "light" | "dark";
/** "theme" uses the active theme's own accent. */
export type Accent = "theme" | "teal" | "blue" | "violet" | "rose" | "amber";
export type StylePreset = "mido" | "github" | "academic" | "minimal";
export type FontRole = "body" | "heading" | "code";

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
  wrap: boolean;
  autosave: boolean;
  /** Check for new versions at launch (and periodically) and offer them. */
  checkForUpdates: boolean;
  /** Name comments are signed with when git has no user. */
  commentAuthor: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  lightTheme: DEFAULT_THEME.light,
  darkTheme: DEFAULT_THEME.dark,
  customThemes: [],
  accent: "theme",
  showPathBar: true,
  style: "mido",
  bodyFont: "inter",
  headingFont: "source-serif",
  codeFont: "jetbrains",
  customBodyFont: "",
  customHeadingFont: "",
  customCodeFont: "",
  fontSize: 16,
  lineHeight: 1.72,
  contentWidth: 780,
  justify: false,
  showFrontmatter: true,
  editorFontSize: 14,
  wrap: true,
  autosave: true,
  checkForUpdates: true,
  commentAuthor: "",
};

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
    description: "Crisp documentation",
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
  const accent = ACCENTS.find((a) => a.id === settings.accent)?.[theme.kind];
  const themeVars = themeVariables(theme, accent);

  root.dataset.theme = theme.kind;
  root.dataset.style = settings.style;
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
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}
