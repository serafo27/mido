// Comment threads on a document. They're stored as events in
// `.mido/comments/<document>/<thread>/` (see src-tauri/src/comments.rs):
// every file holds a batch of events, files are never changed, and a thread
// is whatever all its files add up to, with duplicate events dropped.

export interface Author {
  name: string;
  /** Empty when the author has no git email. */
  email: string;
}

/**
 * Where a thread points in the document's source: the commented text with a
 * little context on each side, so it can be found again after edits.
 */
export interface Anchor {
  exact: string;
  prefix: string;
  suffix: string;
  /** 1-based line the text started on, to choose among repeats. */
  line: number;
}

interface EventBase {
  /** A ULID: sorting ids sorts events by time. */
  id: string;
  thread: string;
  author: Author;
  /** ISO 8601. */
  at: string;
}

export type CommentEvent =
  | (EventBase & { type: "create"; body: string; anchor: Anchor })
  | (EventBase & { type: "reply"; body: string })
  | (EventBase & { type: "delete"; target: string })
  | (EventBase & { type: "resolve" })
  | (EventBase & { type: "reopen" });

export interface CommentFileData {
  thread: string;
  /** File name without `.json`. */
  name: string;
  content: string;
}

export interface Comment {
  id: string;
  author: Author;
  at: string;
  body: string;
}

export interface Thread {
  id: string;
  anchor: Anchor;
  /** The first one opened the thread. Deleted comments are left out. */
  comments: Comment[];
  resolved: boolean;
  /** The files the thread is stored in, which resolving it replaces. */
  files: string[];
  /** Every event, for writing them out again when resolving. */
  events: CommentEvent[];
}

const FORMAT_VERSION = 1;

/* ---------- ids ---------- */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastTime = -1;
let lastRandom: number[] = [];

/**
 * A ULID: 10 characters of time, then 16 random ones. Ids made in the same
 * millisecond still sort in the order they were made.
 */
export function ulid(now = Date.now()): string {
  let random: number[];
  if (now <= lastTime) {
    now = lastTime;
    random = [...lastRandom];
    // Increment the random part, carrying over.
    for (let i = random.length - 1; i >= 0; i--) {
      if (random[i] < 31) {
        random[i]++;
        break;
      }
      random[i] = 0;
    }
  } else {
    random = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b % 32);
  }
  lastTime = now;
  lastRandom = random;
  let time = "";
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  return time + random.map((r) => CROCKFORD[r]).join("");
}

/* ---------- files and threads ---------- */

export function serializeEvents(events: CommentEvent[]): string {
  return JSON.stringify({ version: FORMAT_VERSION, events }, null, 2) + "\n";
}

function parseEvents(content: string): CommentEvent[] {
  try {
    const data = JSON.parse(content);
    if (!Array.isArray(data?.events)) return [];
    return data.events.filter(
      (e: Partial<CommentEvent>) =>
        typeof e?.id === "string" && typeof e.thread === "string" && typeof e.type === "string" && e.author,
    );
  } catch {
    // A broken file (a bad merge, say) hides its events rather than the whole thread.
    return [];
  }
}

/** The threads stored in `files`, in no particular order. */
export function buildThreads(files: CommentFileData[]): Thread[] {
  const byThread = new Map<string, { files: string[]; events: Map<string, CommentEvent> }>();
  for (const file of files) {
    let entry = byThread.get(file.thread);
    if (!entry) byThread.set(file.thread, (entry = { files: [], events: new Map() }));
    entry.files.push(file.name);
    for (const event of parseEvents(file.content)) {
      if (event.thread === file.thread) entry.events.set(event.id, event);
    }
  }

  const threads: Thread[] = [];
  for (const [id, { files, events: byId }] of byThread) {
    const events = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const create = events.find((e) => e.type === "create");
    if (!create) continue;
    const deleted = new Set(events.flatMap((e) => (e.type === "delete" ? [e.target] : [])));
    // Deleting the first comment deletes the thread.
    if (deleted.has(create.id)) continue;

    const comments: Comment[] = [];
    let resolved = false;
    for (const e of events) {
      if (e.type === "create" || e.type === "reply") {
        if (!deleted.has(e.id)) comments.push({ id: e.id, author: e.author, at: e.at, body: e.body });
        // A reply after a resolve (from someone who hadn't seen it yet) reopens the thread.
        if (e.type === "reply") resolved = false;
      } else if (e.type === "resolve") {
        resolved = true;
      } else if (e.type === "reopen") {
        resolved = false;
      }
    }
    threads.push({ id, anchor: create.anchor, comments, resolved, files, events });
  }
  return threads;
}

export function sameAuthor(a: Author, b: Author): boolean {
  return a.email && b.email ? a.email.toLowerCase() === b.email.toLowerCase() : a.name === b.name;
}

/* ---------- anchoring ---------- */

const CONTEXT = 32;

export interface Range {
  from: number;
  to: number;
}

/** The 1-based line `offset` is on. */
export function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = source.indexOf("\n"); i !== -1 && i < offset; i = source.indexOf("\n", i + 1)) line++;
  return line;
}

/** Offset of the start of each line: `offsets[n - 1]` is where line n starts. */
export function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = source.indexOf("\n"); i !== -1; i = source.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

/** `range` without the whitespace at its ends. */
export function trimRange(source: string, { from, to }: Range): Range {
  while (from < to && /\s/.test(source[from])) from++;
  while (to > from && /\s/.test(source[to - 1])) to--;
  return { from, to };
}

export function createAnchor(source: string, { from, to }: Range): Anchor {
  return {
    exact: source.slice(from, to),
    prefix: source.slice(Math.max(0, from - CONTEXT), from),
    suffix: source.slice(to, to + CONTEXT),
    line: lineAt(source, from),
  };
}

/** How many characters `a` and `b` share at their end (`fromEnd`) or start. */
function common(a: string, b: string, fromEnd: boolean): number {
  let n = 0;
  const max = Math.min(a.length, b.length);
  while (n < max && (fromEnd ? a[a.length - 1 - n] === b[b.length - 1 - n] : a[n] === b[n])) n++;
  return n;
}

/**
 * Finds the anchored text in `source`, which may have changed since. Among
 * several copies of the text, prefers the one whose surroundings match best,
 * then the one nearest its old line. If the text itself was edited, finds
 * what now sits between its old surroundings. `null` if it's gone.
 */
export function locate(source: string, anchor: Anchor): Range | null {
  const { exact, prefix, suffix } = anchor;
  let best: Range | null = null;
  let bestContext = -1;
  let bestScore = -Infinity;
  if (exact) {
    for (let at = source.indexOf(exact); at !== -1; at = source.indexOf(exact, at + 1)) {
      const before = source.slice(Math.max(0, at - prefix.length), at);
      const after = source.slice(at + exact.length, at + exact.length + suffix.length);
      const context = common(before, prefix, true) + common(after, suffix, false);
      const score = context * 1000 - Math.abs(lineAt(source, at) - anchor.line);
      if (score > bestScore) {
        bestScore = score;
        bestContext = context;
        best = { from: at, to: at + exact.length };
      }
    }
  }
  // A copy in the same place: done. Otherwise the text may have been edited,
  // and a copy elsewhere is only a coincidence if its old surroundings are still there.
  if (best && bestContext * 2 >= prefix.length + suffix.length) return best;
  return between(source, anchor) ?? best;
}

/** What sits between the anchor's old surroundings, if they're still there and close together. */
function between(source: string, { exact, prefix, suffix }: Anchor): Range | null {
  if (prefix.length < 8 || suffix.length < 8) return null;
  const maxGap = Math.max(200, exact.length * 3);
  for (let p = source.indexOf(prefix); p !== -1; p = source.indexOf(prefix, p + 1)) {
    const from = p + prefix.length;
    const s = source.indexOf(suffix, from);
    if (s !== -1 && s > from && s - from <= maxGap) return { from, to: s };
  }
  return null;
}

/** Commented source text as it reads on the page, for quoting it: without Markdown markup. */
export function plainQuote(source: string): string {
  return source
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/* ---------- rendered text ↔ source ---------- */

const WORD = /[\p{L}\p{N}]+/gu;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A pattern for text made of `words`, with up to `gap` other characters
 * between them: Markdown markup in the source, or punctuation and spaces in
 * the rendered page.
 */
export function wordsPattern(words: string[], gap: string): RegExp | null {
  if (words.length === 0) return null;
  return new RegExp(words.map(escapeRegExp).join(gap), "u");
}

/** The words of rendered `text`. */
export function wordsOf(text: string): string[] {
  return text.match(WORD) ?? [];
}

/** The words of Markdown `source` that show on the page: link targets and HTML tags don't. */
export function visibleWordsOf(source: string): string[] {
  return wordsOf(source.replace(/\]\([^)]*\)/g, "]").replace(/<[^>]*>/g, " "));
}

/**
 * Where text selected on the rendered page comes from, searching the source
 * between `from` and `to` (the blocks the selection is in). Markup may sit
 * between the words in the source, so the words are matched loosely.
 */
export function findRenderedText(source: string, text: string, from: number, to: number): Range | null {
  const slice = source.slice(from, to);
  const trimmed = text.trim();
  const direct = trimmed ? slice.indexOf(trimmed) : -1;
  if (direct !== -1) return { from: from + direct, to: from + direct + trimmed.length };
  const pattern = wordsPattern(wordsOf(text), "[\\s\\S]{0,80}?");
  const match = pattern?.exec(slice);
  return match ? { from: from + match.index, to: from + match.index + match[0].length } : null;
}
