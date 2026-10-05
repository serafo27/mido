// Minimal Mode (View menu, macOS): only the document shows, to read and write.

type Keys = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/**
 * Whether a shortcut would show something Minimal Mode hides (the sidebar,
 * search, source control, outline, comments, the terminal, the git dialogs):
 * it does nothing there. Saving, the view modes, text size, wrapping, quick
 * open and switching files still work.
 */
export function hiddenByMinimal(e: Keys, mac: boolean): boolean {
  const mod = mac ? e.metaKey : e.ctrlKey;
  // ⌃` and ⌃⇧`: the terminal. ⌃⇧G: source control.
  if (e.ctrlKey && !e.metaKey && !e.altKey && (e.code === "Backquote" || e.code === "IntlBackslash")) return true;
  if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && e.code === "KeyG") return true;
  if (!mod) return false;
  // ⌘K and ⌘⇧K: the commit and push dialogs. ⌥⌘M: a new comment.
  if (!e.altKey && e.code === "KeyK") return true;
  if (e.altKey && !e.shiftKey && e.code === "KeyM") return true;
  if (e.altKey) return false;
  // ⌘\: the sidebar (by the character, as the app reads it). ⌘⇧O, ⌘⇧M, ⌘⇧F: outline, comments, search.
  if (!e.shiftKey && e.key === "\\") return true;
  return e.shiftKey && ["KeyO", "KeyM", "KeyF"].includes(e.code);
}
