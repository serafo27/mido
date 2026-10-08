// The theme an app hosting embedded Mido sends (docs/embed.md, `host:theme`).
// Embedded, it's the only theme: Mido's own themes and accents step aside.
import { useSyncExternalStore } from "react";
import type { AnsiColors, Palette, Theme, ThemeKind } from "./themes";

export interface HostThemeMessage {
  /** Shown in Settings, e.g. "Host Dark": the host app's name and its theme's. */
  name: string;
  kind: ThemeKind;
  palette: Palette;
  /** The terminal's colours; derived from the palette when missing. */
  ansi?: AnsiColors;
}

export const HOST_THEME_ID = "host";

let theme: Theme | null = null;
let ansi: AnsiColors | null = null;
let version = 0;
const listeners = new Set<() => void>();

export function setHostTheme(message: HostThemeMessage) {
  theme = { id: HOST_THEME_ID, name: message.name, kind: message.kind, palette: message.palette };
  ansi = message.ansi ?? null;
  version++;
  for (const l of listeners) l();
}

export const hostTheme = (): Theme | null => theme;
export const hostAnsi = (): AnsiColors | null => ansi;

/** Changes whenever the host sends a theme: a dependency for effects that apply it. */
export function useHostThemeVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}
