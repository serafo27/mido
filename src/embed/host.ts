// What embedded Mido asks of its host, beyond the Tauri calls the shims forward.
import { notify } from "./bridge";

/** The host's terminal: opens a new one, or shows or hides its panel (⌃⇧` and ⌃`). */
export function hostTerminal(action: "new" | "toggle") {
  notify("terminal", action);
}
