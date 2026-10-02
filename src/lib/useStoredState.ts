import { useCallback, useEffect, useState } from "react";
import { isMainWindow } from "./platform";

interface StoredStateOptions {
  /**
   * What's open in this window (its folder, its tabs) rather than a preference.
   * The main window remembers it across launches; the others only while they're open.
   */
  perWindow?: boolean;
  /** Follows the changes other windows make, so a preference set in one applies to all. */
  shared?: boolean;
}

const storageFor = (perWindow: boolean) => (perWindow && !isMainWindow ? sessionStorage : localStorage);

function parse<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** useState persisted to localStorage as JSON. */
export function useStoredState<T>(key: string, initial: T, { perWindow = false, shared = false }: StoredStateOptions = {}) {
  const [value, setValue] = useState<T>(() => {
    try {
      return parse(storageFor(perWindow).getItem(key), initial);
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          storageFor(perWindow).setItem(key, JSON.stringify(resolved));
        } catch {
          // Storage unavailable: keep the in-memory value.
        }
        return resolved;
      });
    },
    [key, perWindow],
  );

  // The storage event only fires for changes made by other windows.
  useEffect(() => {
    if (!shared) return;
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea === localStorage && e.key === key) setValue(parse(e.newValue, initial));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // `initial` is only the fallback for a value that was removed.
  }, [key, shared]);

  return [value, set] as const;
}
