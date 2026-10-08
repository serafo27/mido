// Embedded stand-in for @tauri-apps/api/window: the host's window holds Mido.
import { notify, on } from "../bridge";
import { listen } from "./event";

const closeHandlers = new Set<(event: { preventDefault(): void }) => unknown>();

const current = {
  label: "main",
  listen,
  async setTitle(title: string) {
    notify("title", title);
  },
  async setFocus() {},
  async startDragging() {},
  async destroy() {},
  /** The host asks before Mido goes away (closing the app, hiding the docs). */
  async onCloseRequested(handler: (event: { preventDefault(): void }) => unknown) {
    closeHandlers.add(handler);
    return () => void closeHandlers.delete(handler);
  },
};

export function getCurrentWindow() {
  return current;
}

/** Runs the close handlers (saving or asking about unsaved edits); false if one kept Mido open. */
export async function runCloseHandlers(): Promise<boolean> {
  let prevented = false;
  for (const handler of closeHandlers) {
    await handler({ preventDefault: () => (prevented = true) });
  }
  return !prevented;
}

// The host asks before switching folder or quitting; Mido answers once its edits are safe.
on("host:close-request", async () => notify("close-result", await runCloseHandlers()));
