// Keys a terminal sends differently from what xterm.js does on its own, so
// they work as in Terminal, iTerm2 and VS Code's terminal.

type Key = Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey">;

/** What to send to the shell for `e`, or null to let xterm.js handle it. */
export function terminalKeyInput(e: Key, mac: boolean): string | null {
  const only = (shift: boolean, alt: boolean, ctrl: boolean, meta: boolean) =>
    e.shiftKey === shift && e.altKey === alt && e.ctrlKey === ctrl && e.metaKey === meta;
  // ⇧↩: a new line without sending, as Claude Code's /terminal-setup sets it up
  // (ESC CR, the same as ⌥↩). xterm.js sends a plain CR, the same as ↩.
  if (e.key === "Enter" && only(true, false, false, false)) return "\x1b\r";
  if (!mac) return null;
  // ⌥← ⌥→: a word back or forward (meta-b / meta-f), as Terminal sends them.
  if (only(false, true, false, false)) {
    if (e.key === "ArrowLeft") return "\x1bb";
    if (e.key === "ArrowRight") return "\x1bf";
  }
  // ⌘← ⌘→ ⌘⌫: start and end of the line, delete to its start, as in VS Code and iTerm2.
  if (only(false, false, false, true)) {
    if (e.key === "ArrowLeft") return "\x01";
    if (e.key === "ArrowRight") return "\x05";
    if (e.key === "Backspace") return "\x15";
  }
  return null;
}
