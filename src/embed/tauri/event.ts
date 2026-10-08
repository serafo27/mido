// Embedded stand-in for @tauri-apps/api/event: the host sends events over the bridge.
import { dispatch, on } from "../bridge";

export async function listen<T>(event: string, handler: (event: { event: string; payload: T }) => void) {
  return on(event, handler as (event: { event: string; payload: unknown }) => void);
}

/** Embedded Mido is a single window: its own events stay inside it. */
export async function emit(event: string, payload?: unknown) {
  dispatch(event, payload);
}

export async function emitTo(_target: string, event: string, payload?: unknown) {
  dispatch(event, payload);
}
