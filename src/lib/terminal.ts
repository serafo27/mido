// The backend's terminals (src-tauri/src/terminal.rs): a shell in a
// pseudo-terminal, its output streamed back as raw bytes.
import { Channel, invoke } from "@tauri-apps/api/core";

export interface TerminalHandlers {
  onData: (data: Uint8Array) => void;
  /** The shell exited, with its code when it has one. */
  onExit: (code: number | null) => void;
}

/** Starts a shell in the window's open folder; resolves to its id. */
export function spawnTerminal(cols: number, rows: number, handlers: TerminalHandlers): Promise<number> {
  const onData = new Channel<ArrayBuffer>();
  onData.onmessage = (data) => handlers.onData(new Uint8Array(data));
  const onExit = new Channel<number | null>();
  onExit.onmessage = handlers.onExit;
  return invoke<number>("pty_spawn", { cols, rows, onData, onExit });
}

export const writeTerminal = (id: number, data: string) => invoke<void>("pty_write", { id, data });
export const resizeTerminal = (id: number, cols: number, rows: number) =>
  invoke<void>("pty_resize", { id, cols, rows });
export const killTerminal = (id: number) => invoke<void>("pty_kill", { id });
