// Web stand-in for @tauri-apps/api/event.
import { on, send } from "../events";

export async function listen<T>(event: string, handler: (event: { event: string; payload: T }) => void) {
  return on(event, handler as (event: { event: string; payload: unknown }) => void);
}

export async function emit(event: string, payload?: unknown) {
  send(event, payload);
}

/** The web version has a single window: the event goes to it. */
export async function emitTo(_target: string, event: string, payload?: unknown) {
  send(event, payload);
}
