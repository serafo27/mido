// In Split, the text selected on one side is highlighted on the other: the
// editor and the preview each publish their selection as a range of the
// Markdown source, and paint the one the other side published.
import type { Range } from "./comments";

export interface MirroredSelection extends Range {
  /** The document it's a range of. */
  path: string;
  /** Where the text is selected; the other side highlights it. */
  side: "editor" | "preview";
}

let current: MirroredSelection | null = null;
const listeners = new Set<(selection: MirroredSelection | null) => void>();

const same = (a: MirroredSelection | null, b: MirroredSelection | null) =>
  a === b || (!!a && !!b && a.path === b.path && a.side === b.side && a.from === b.from && a.to === b.to);

/** `side`'s selection in `path` is now `range`, or nothing (null). */
export function publishSelection(path: string, side: MirroredSelection["side"], range: Range | null) {
  // Nothing selected here doesn't clear what the other side has selected.
  if (!range && current && (current.side !== side || current.path !== path)) return;
  const next = range && range.from < range.to ? { path, side, from: range.from, to: range.to } : null;
  if (same(next, current)) return;
  current = next;
  listeners.forEach((listener) => listener(next));
}

/** Calls `listener` with the selection now and whenever it changes; returns the unsubscribe. */
export function watchSelection(listener: (selection: MirroredSelection | null) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}
