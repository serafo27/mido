import { useEffect, useMemo, useState } from "react";
import { applySettings, DEFAULT_SETTINGS, type Settings } from "./settings";
import { useHostThemeVersion } from "./hostTheme";
import { useStoredState } from "./useStoredState";

/**
 * For a floating window (a terminal's, the commit dialog's): the app's theme
 * and fonts, following the changes made in its other windows.
 */
export function useAppearance(): Settings {
  const [stored] = useStoredState<Partial<Settings>>("mido.settings", {}, { shared: true });
  const settings = useMemo<Settings>(() => ({ ...DEFAULT_SETTINGS, ...stored }), [stored]);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const hostTheme = useHostThemeVersion();
  useEffect(() => applySettings(settings, systemDark), [settings, systemDark, hostTheme]);
  return settings;
}
