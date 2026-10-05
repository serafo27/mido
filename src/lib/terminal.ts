// The backend's terminals (src-tauri/src/terminal.rs): a shell in a
// pseudo-terminal, its output streamed back as raw bytes.
import { Channel, invoke } from "@tauri-apps/api/core";

export interface TerminalHandlers {
  onData: (data: Uint8Array) => void;
  /** The shell exited, with its code when it has one. */
  onExit: (code: number | null) => void;
}

function channels(handlers: TerminalHandlers) {
  const onData = new Channel<ArrayBuffer>();
  onData.onmessage = (data) => handlers.onData(new Uint8Array(data));
  const onExit = new Channel<number | null>();
  onExit.onmessage = handlers.onExit;
  return { onData, onExit };
}

/** Starts a shell in the window's open folder; resolves to its id. */
export const spawnTerminal = (cols: number, rows: number, handlers: TerminalHandlers) =>
  invoke<number>("pty_spawn", { cols, rows, ...channels(handlers) });

/**
 * Holds a terminal's output back, to move it to another window. Resolves to
 * how many bytes were sent: wait for them all before saving the screen.
 */
export const detachTerminal = (id: number) => invoke<number>("pty_detach", { id });

/** Sends a detached terminal's output here again, starting with what was held back. Fails when its shell has ended. */
export const attachTerminal = (id: number, handlers: TerminalHandlers) =>
  invoke<void>("pty_attach", { id, ...channels(handlers) });

/** A terminal on its way to another window (src-tauri/src/floating.rs). */
export interface Handoff {
  pty: number;
  title: string;
  /** Its screen and scrollback, serialized by xterm.js. */
  screen: string;
  /** The size the screen was saved at. */
  cols: number;
  rows: number;
  /** Its own text size, in pixels away from the editor's. */
  fontOffset: number;
}

/** Moves a detached terminal into a floating window. */
export const openTerminalWindow = (handoff: Handoff) => invoke<void>("open_terminal_window", { handoff });
/** In a floating window: the terminal it was opened for (null after a reload). */
export const takeFloatingTerminal = () => invoke<Handoff | null>("terminal_window");
/** In a floating window: puts its detached terminal back in its window's panel, and closes. */
export const dockTerminal = (handoff: Handoff) => invoke<void>("dock_terminal", { handoff });
/** What a window gets when a floating terminal comes back to its panel. */
export const TERMINAL_DOCKED = "terminal-docked";

export const writeTerminal = (id: number, data: string) => invoke<void>("pty_write", { id, data });
export const resizeTerminal = (id: number, cols: number, rows: number) =>
  invoke<void>("pty_resize", { id, cols, rows });
export const killTerminal = (id: number) => invoke<void>("pty_kill", { id });
