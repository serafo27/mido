// An in-page stand-in for Tauri's event system.

type Handler = (event: { event: string; payload: unknown }) => void;

const handlers = new Map<string, Set<Handler>>();

export function on(event: string, handler: Handler): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(handler);
  return () => handlers.get(event)?.delete(handler);
}

export function send(event: string, payload?: unknown) {
  for (const handler of [...(handlers.get(event) ?? [])]) handler({ event, payload });
}
