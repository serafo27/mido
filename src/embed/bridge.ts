// The channel between embedded Mido and the app hosting it (see docs/embed.md).
// Mido runs in an iframe; every Tauri call becomes a message to the parent
// window, which answers it within the folder it chose to open.

import { EMBED_PROTOCOL } from "./protocol";

type Listener = (event: { event: string; payload: unknown }) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const pending = new Map<number, Pending>();
/** Channels passed to commands, by id: the host streams their messages back (e.g. a terminal's output). */
const channels = new Map<number, { onmessage: (message: unknown) => void }>();
let nextChannel = 1;

/** Registers a channel; it travels to the host as `{ __midoChannel: id }`. */
export function registerChannel(channel: { onmessage: (message: unknown) => void }): number {
  const id = nextChannel++;
  channels.set(id, channel);
  return id;
}

/** Channels can't be cloned into a message: they go as their id. */
function marshal(args: unknown): unknown {
  if (!args || typeof args !== "object" || args instanceof Uint8Array || Array.isArray(args)) return args;
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) => [
      k,
      v && typeof v === "object" && typeof (v as { __midoChannel?: unknown }).__midoChannel === "number"
        ? { __midoChannel: (v as { __midoChannel: number }).__midoChannel }
        : v,
    ]),
  );
}
const listeners = new Map<string, Set<Listener>>();
let nextId = 1;

function post(message: Record<string, unknown>, transfer: Transferable[] = []) {
  // The host checks the message comes from its iframe; the reply can only come from window.parent.
  window.parent.postMessage({ mido: EMBED_PROTOCOL, ...message }, "*", transfer);
}

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window.parent || !e.data || e.data.mido !== EMBED_PROTOCOL) return;
  const msg = e.data as {
    type: string;
    id?: number;
    ok?: boolean;
    value?: unknown;
    error?: unknown;
    event?: string;
    payload?: unknown;
    message?: unknown;
  };
  if (msg.type === "result" && msg.id !== undefined) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.ok) p?.resolve(msg.value);
    else p?.reject(msg.error);
  } else if (msg.type === "event" && msg.event) {
    dispatch(msg.event, msg.payload);
  } else if (msg.type === "channel" && msg.id !== undefined) {
    channels.get(msg.id)?.onmessage(msg.message);
  }
});

/** Runs `command` in the host, as `invoke` would in the desktop app. */
export function request<T>(command: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    post({ type: "invoke", id, command, args: marshal(args), headers: options?.headers });
  });
}

/** Tells the host something, without waiting for an answer. */
export function notify(type: string, payload?: unknown) {
  post({ type, payload });
}

/**
 * Events that came before anyone listened. The host answers `ready` at once,
 * while the view may still be loading (the terminal view is a lazy chunk):
 * they wait here for the first listener instead of being lost.
 */
const early = new Map<string, unknown[]>();

export function dispatch(event: string, payload: unknown) {
  const set = listeners.get(event);
  if (!set?.size) {
    early.set(event, [...(early.get(event) ?? []), payload]);
    return;
  }
  for (const l of set) l({ event, payload });
}

export function on(event: string, listener: Listener): () => void {
  let set = listeners.get(event);
  if (!set) listeners.set(event, (set = new Set()));
  set.add(listener);
  const waiting = early.get(event);
  if (waiting) {
    early.delete(event);
    // After the caller has finished setting up, as an event would arrive.
    queueMicrotask(() => waiting.forEach((payload) => listener({ event, payload })));
  }
  return () => set.delete(listener);
}

// Ready once the page has loaded: the host then sends the folder to open.
notify("ready", { version: import.meta.env.VITE_APP_VERSION });
