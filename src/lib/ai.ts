// The assistant (src-tauri/src/ai.rs): Claude Code, run in the window's folder.
// Its events are JSON lines (`--output-format stream-json`); `reduce` folds
// them into the chat the panel shows.
import { Channel, invoke } from "@tauri-apps/api/core";
import { isInside, relative } from "./paths";

/** Something the assistant used: a file it read, a search. */
export interface ToolUse {
  kind: "tool";
  key: string;
  /** The tool's call id, which its result refers to. */
  id: string;
  name: string;
  /** Its input as JSON, possibly still arriving. */
  input: string;
  status: "running" | "done" | "error";
}

/** It asks to write a file outside its notes folder: the user allows it or not. */
export interface PermissionRequest {
  kind: "permission";
  key: string;
  requestId: string;
  /** The tool call it's for. */
  toolUseId: string;
  /** Write (a whole file) or Edit (a part of one). */
  name: string;
  /** What it asked to write, as JSON: `file_path`, and `content` or `old_string` and `new_string`. */
  input: string;
  /** Expired: the answer ended (or was stopped) before the user decided. */
  status: "pending" | "allowed" | "declined" | "expired";
}

export type ChatItem =
  | { kind: "user"; text: string; /** The text selected in the document it's about. */ quote?: string }
  | { kind: "text"; key: string; text: string }
  | ToolUse
  | PermissionRequest
  | { kind: "error"; text: string };

/** What the assistant can read: the documents open in the window, its folder, or every folder open in Mido. */
export type Scope = "openFiles" | "project" | "allProjects";

export interface Chat {
  /** The conversation to resume; null until the first answer starts one. */
  session: string | null;
  /** The open documents sent in this conversation, by path, as a hash of what was sent (see `documentsToShare`). */
  shared?: Record<string, string>;
  items: ChatItem[];
  /** An answer is on its way. */
  busy: boolean;
  /** The message being streamed (its parts are keyed by it). */
  streaming?: string;
}

export const EMPTY_CHAT: Chat = { session: null, items: [], busy: false };

type Json = Record<string, any>;

/** Adds `item`, or replaces the one with the same key. */
function upsert(items: ChatItem[], item: ChatItem & { key: string }): ChatItem[] {
  const at = items.findIndex((i) => "key" in i && i.key === item.key);
  if (at < 0) return [...items, item];
  const next = items.slice();
  next[at] = item;
  return next;
}

function update(items: ChatItem[], key: string, change: (item: ChatItem) => ChatItem): ChatItem[] {
  return items.map((i) => ("key" in i && i.key === key ? change(i) : i));
}

/** A complete content block from the assistant, as a chat item (null for those not shown, like thinking). */
function blockItem(key: string, block: Json, previous?: ChatItem): (ChatItem & { key: string }) | null {
  if (block.type === "text") return { kind: "text", key, text: String(block.text ?? "") };
  if (block.type === "tool_use") {
    const status = previous?.kind === "tool" ? previous.status : "running";
    return { kind: "tool", key, id: String(block.id), name: String(block.name), input: JSON.stringify(block.input ?? {}), status };
  }
  return null;
}

/** Folds one of the assistant's events (a JSON line) into the chat. */
export function reduce(chat: Chat, line: string): Chat {
  let event: Json;
  try {
    event = JSON.parse(line);
  } catch {
    return chat;
  }
  switch (event.type) {
    case "system":
      return event.subtype === "init" && event.session_id ? { ...chat, session: event.session_id } : chat;

    case "stream_event": {
      const e: Json = event.event ?? {};
      if (e.type === "message_start") return { ...chat, streaming: e.message?.id };
      if (!chat.streaming) return chat;
      const key = `${chat.streaming}:${e.index}`;
      if (e.type === "content_block_start") {
        const item = blockItem(key, { ...e.content_block, input: undefined });
        if (!item) return chat;
        if (item.kind === "tool") item.input = "";
        return { ...chat, items: upsert(chat.items, item) };
      }
      if (e.type === "content_block_delta") {
        const d: Json = e.delta ?? {};
        return {
          ...chat,
          items: update(chat.items, key, (i) =>
            i.kind === "text" && d.type === "text_delta"
              ? { ...i, text: i.text + d.text }
              : i.kind === "tool" && d.type === "input_json_delta"
                ? { ...i, input: i.input + d.partial_json }
                : i,
          ),
        };
      }
      return chat;
    }

    // Complete content: what was streamed, as it ended up. It may come a block
    // at a time, so its blocks are matched by tool call, not by position.
    case "assistant": {
      const id = String(event.message?.id);
      const content: Json[] = Array.isArray(event.message?.content) ? event.message.content : [];
      const streamed = chat.items.some((i) => "key" in i && i.key.startsWith(`${id}:`));
      let items = chat.items;
      for (const block of content) {
        if (block.type === "tool_use" && items.some((i) => i.kind === "tool" && i.id === block.id)) {
          const input = JSON.stringify(block.input ?? {});
          items = items.map((i) => (i.kind === "tool" && i.id === block.id ? { ...i, input } : i));
        } else if (!streamed) {
          // Keyed apart from streamed blocks (`id:index`).
          const item = blockItem(`${id}#${items.length}`, block);
          if (item) items = [...items, item];
        }
      }
      return { ...chat, items };
    }

    // It asks to write outside its notes folder.
    case "control_request": {
      const request: Json = event.request ?? {};
      if (request.subtype !== "can_use_tool" || typeof event.request_id !== "string") return chat;
      const item: PermissionRequest = {
        kind: "permission",
        key: `permission:${event.request_id}`,
        requestId: event.request_id,
        toolUseId: String(request.tool_use_id ?? ""),
        name: String(request.tool_name),
        input: JSON.stringify(request.input ?? {}),
        status: "pending",
      };
      return { ...chat, items: [...chat.items, item] };
    }

    // The results of the tools it used.
    case "user": {
      const content: Json[] = Array.isArray(event.message?.content) ? event.message.content : [];
      let items = chat.items;
      for (const block of content) {
        if (block.type !== "tool_result") continue;
        const status = block.is_error ? "error" : "done";
        items = items.map((i) => (i.kind === "tool" && i.id === block.tool_use_id ? { ...i, status } : i));
      }
      return { ...chat, items };
    }

    case "result": {
      const items = settle(chat.items);
      const session = event.session_id ?? chat.session;
      if (event.is_error) {
        const text = typeof event.result === "string" && event.result ? event.result : `The answer failed (${event.subtype}).`;
        return { session, busy: false, items: [...items, { kind: "error", text }] };
      }
      return { session, busy: false, items };
    }

    // Mido's own: the assistant stopped. Mid-answer, that's an error.
    case "mido_exit": {
      if (!chat.busy) return chat;
      const why = String(event.stderr ?? "").trim();
      const text = why ? `The assistant stopped: ${why}` : "The assistant stopped.";
      return { ...chat, busy: false, streaming: undefined, items: [...settle(chat.items), { kind: "error", text }] };
    }
  }
  return chat;
}

/** Tools still running when the answer ended won't finish, and its requests won't be answered. */
const settle = (items: ChatItem[]) =>
  items.map((i) =>
    i.kind === "tool" && i.status === "running"
      ? { ...i, status: "done" as const }
      : i.kind === "permission" && i.status === "pending"
        ? { ...i, status: "expired" as const }
        : i,
  );

/** The user's answer to a request, in the chat. */
export const decide = (chat: Chat, requestId: string, allow: boolean): Chat => ({
  ...chat,
  items: chat.items.map((i) =>
    i.kind === "permission" && i.requestId === requestId ? { ...i, status: allow ? "allowed" : "declined" } : i,
  ),
});

/** What a tool use is about, in a few words: the file read, the text searched for. */
export function describeTool(tool: ToolUse, root: string): { verb: string; detail: string; path?: string } {
  let input: Json = {};
  try {
    input = JSON.parse(tool.input || "{}");
  } catch {
    // Still arriving.
  }
  const show = (p: unknown) => (typeof p === "string" ? (isInside(root, p) ? relative(root, p) : p) : "");
  switch (tool.name) {
    case "Read":
      return { verb: "Read", detail: show(input.file_path), path: typeof input.file_path === "string" ? input.file_path : undefined };
    case "Write":
    case "Edit": {
      const verb = tool.status === "error" ? "Didn't write" : tool.name === "Write" ? "Wrote" : "Edited";
      return { verb, detail: show(input.file_path), path: typeof input.file_path === "string" ? input.file_path : undefined };
    }
    case "Grep":
      return { verb: "Searched for", detail: input.pattern ? `“${input.pattern}”` : "" };
    case "Glob":
      return { verb: "Looked for", detail: input.pattern ?? "" };
  }
  return { verb: tool.name, detail: "" };
}

export interface SharedDocument {
  /** Relative to the folder. */
  path: string;
  content: string;
}

/** The most of a document sent, and of all of them in one message. */
const MAX_DOCUMENT = 100_000;
const MAX_DOCUMENTS = 300_000;

/** A short fingerprint of a document's text (FNV-1a), to tell whether it changed since it was sent. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

/**
 * The open documents to send with the next message: those not sent yet in
 * this conversation, or changed since (unsaved edits too). With what's been
 * sent once they are.
 */
export function documentsToShare(open: SharedDocument[], shared: Record<string, string> = {}) {
  const documents: SharedDocument[] = [];
  const next = { ...shared };
  let budget = MAX_DOCUMENTS;
  for (const doc of open) {
    const print = fingerprint(doc.content);
    if (shared[doc.path] === print) continue;
    const room = Math.min(MAX_DOCUMENT, budget);
    if (room <= 0) break;
    const cut = doc.content.length > room;
    documents.push({ path: doc.path, content: cut ? `${doc.content.slice(0, room)}\n\n[… cut: too long to send whole]` : doc.content });
    budget -= Math.min(doc.content.length, room);
    next[doc.path] = print;
  }
  return { documents, shared: next };
}

/** The message sent for what the user wrote: with the document they're reading and the text they selected. */
export function composeMessage(
  text: string,
  context: { document?: string; quote?: string; open?: string[]; documents?: SharedDocument[] },
): string {
  const parts: string[] = [];
  for (const doc of context.documents ?? []) parts.push(`<document path="${doc.path}">\n${doc.content}\n</document>`);
  if (context.open) parts.push(`(Open in Mido: ${context.open.join(", ") || "nothing"}.)`);
  if (context.document) parts.push(`(I'm reading ${context.document} in Mido.)`);
  if (context.quote) parts.push(`About this passage:\n\n${context.quote.replace(/^/gm, "> ")}`);
  parts.push(text);
  return parts.join("\n\n");
}

/** The file tools whose results Mido opens: what the assistant wrote. */
export const writesFiles = (tool: ToolUse) => tool.name === "Write" || tool.name === "Edit";

/** A question and its answer, as a Markdown note: its file name (without extension) and its text. */
export function noteFor(question: string, answer: string, quote?: string): { name: string; content: string } {
  const title = question.split("\n")[0].trim().slice(0, 80) || "Answer";
  const name =
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .slice(0, 8)
      .join("-") || "answer";
  const parts = [`# ${title}`];
  if (quote) parts.push(quote.replace(/^/gm, "> "));
  parts.push(answer.trim());
  return { name, content: parts.join("\n\n") + "\n" };
}

/** The chat in turns: each question with the text of its answer (null while it's on its way). */
export function turns(items: ChatItem[]): { at: number; question: string; quote?: string; answer: string }[] {
  const out: { at: number; question: string; quote?: string; answer: string }[] = [];
  items.forEach((item, i) => {
    if (item.kind === "user") out.push({ at: i, question: item.text, quote: item.quote, answer: "" });
    else if (item.kind === "text" && out.length) {
      const turn = out[out.length - 1];
      turn.answer = turn.answer ? `${turn.answer}\n\n${item.text}` : item.text;
    }
  });
  return out;
}

/** A line of a diff: kept (" "), removed ("-") or added ("+"); "…" stands for unchanged lines left out. */
export type DiffLine = { type: " " | "-" | "+" | "…"; text: string };

/** The most lines compared line by line; past it, the diff is the old text removed and the new one added. */
const MAX_DIFF_CELLS = 4_000_000;

/** The lines that changed from `before` to `after`, with `context` unchanged lines around each change. */
export function lineDiff(before: string, after: string, context = 2): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // Lines in common at the start and the end are cheap to set aside.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) endA--, endB--;
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  let middle: DiffLine[];
  if (midA.length * midB.length > MAX_DIFF_CELLS) {
    middle = [...midA.map((text) => ({ type: "-" as const, text })), ...midB.map((text) => ({ type: "+" as const, text }))];
  } else {
    // Longest common subsequence, from the end.
    const n = midA.length;
    const m = midB.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    middle = [];
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) middle.push({ type: " ", text: midA[i++] }), j++;
      // Lines removed before those added in their place.
      else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) middle.push({ type: "-", text: midA[i++] });
      else middle.push({ type: "+", text: midB[j++] });
    }
  }
  const all: DiffLine[] = [
    ...a.slice(0, start).map((text) => ({ type: " " as const, text })),
    ...middle,
    ...a.slice(endA).map((text) => ({ type: " " as const, text })),
  ];
  // Only the changes, with their context.
  const near = all.map(() => false);
  all.forEach((line, k) => {
    if (line.type === " ") return;
    for (let c = Math.max(0, k - context); c <= Math.min(all.length - 1, k + context); c++) near[c] = true;
  });
  const out: DiffLine[] = [];
  all.forEach((line, k) => {
    if (near[k]) out.push(line);
    else if (out.at(-1)?.type !== "…") out.push({ type: "…", text: "" });
  });
  return out;
}

/* ---------- the conversations, kept per folder ---------- */

/** A conversation: its chat, a title, and when it was last asked something. */
export interface Conversation extends Chat {
  id: string;
  /** Its first question, cut short. */
  title: string;
  /** Milliseconds since 1970. */
  updated: number;
}

/** A folder's conversations: those open in the panel (one shown), and the rest, its history. */
export interface Conversations {
  all: Conversation[];
  /** Open ones, by id, in the order they were opened. */
  open: string[];
  /** The one shown; null: none open, the history shows. */
  active: string | null;
}

const STORAGE_KEY = "mido.aiChats";
/** The most items kept for a conversation; older ones go (the assistant still remembers them). */
const MAX_ITEMS = 200;
/** The most conversations kept for a folder: open ones, then the latest. */
const MAX_KEPT = 20;
const MAX_TITLE = 60;

export function newConversation(): Conversation {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return { ...EMPTY_CHAT, id, title: "", updated: Date.now() };
}

/** What a conversation is called: its first question. */
export const titleFor = (question: string) => {
  const line = question.trim().split("\n")[0];
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1).trimEnd()}…` : line;
};

/** A conversation shown: added to the open ones if it wasn't. */
export function openConversation(convs: Conversations, id: string): Conversations {
  return { ...convs, open: convs.open.includes(id) ? convs.open : [...convs.open, id], active: id };
}

/** A conversation closed: into the history. The one next to it shows, or the history when none is left. */
export function closeConversation(convs: Conversations, id: string): Conversations {
  const at = convs.open.indexOf(id);
  const open = convs.open.filter((o) => o !== id);
  const active = convs.active !== id ? convs.active : (open[Math.min(at, open.length - 1)] ?? null);
  // An empty conversation leaves nothing to remember.
  const all = convs.all.filter((c) => c.id !== id || c.items.length > 0);
  return { all, open, active };
}

/** A conversation forgotten: out of the history. */
export const forgetConversation = (convs: Conversations, id: string): Conversations => ({
  ...closeConversation(convs, id),
  all: convs.all.filter((c) => c.id !== id),
});

/** The closed conversations, latest first. */
export const history = (convs: Conversations) =>
  convs.all.filter((c) => !convs.open.includes(c.id) && c.items.length > 0).sort((a, b) => b.updated - a.updated);

function stored(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

const EMPTY_CONVERSATIONS: Conversations = { all: [], open: [], active: null };

/** A folder's conversations, as kept (and as kept before there were several: one chat). */
export function readConversations(value: unknown): Conversations {
  if (!value || typeof value !== "object") return EMPTY_CONVERSATIONS;
  const v = value as Partial<Conversations> & Partial<Chat>;
  if (Array.isArray(v.items)) {
    if (v.items.length === 0) return EMPTY_CONVERSATIONS;
    const first = v.items.find((i) => i.kind === "user");
    const conv: Conversation = {
      ...newConversation(),
      session: v.session ?? null,
      shared: v.shared,
      items: v.items,
      title: first && first.kind === "user" ? titleFor(first.text) : "",
    };
    return { all: [conv], open: [conv.id], active: conv.id };
  }
  const all = (Array.isArray(v.all) ? v.all : []).map((c) => ({ ...c, busy: false, streaming: undefined }));
  const ids = new Set(all.map((c) => c.id));
  const open = (Array.isArray(v.open) ? v.open : []).filter((id) => ids.has(id));
  const active = v.active && open.includes(v.active) ? v.active : (open[0] ?? null);
  return { all, open, active };
}

/** The conversations held about `root`. */
export const loadConversations = (root: string) => readConversations(stored()[root]);

/** What's kept of a folder's conversations: the open ones and the latest, without what's on its way. */
export function keptConversations(convs: Conversations): Conversations {
  const latest = new Set(history(convs).slice(0, Math.max(0, MAX_KEPT - convs.open.length)).map((c) => c.id));
  const all = convs.all
    .filter((c) => convs.open.includes(c.id) || latest.has(c.id))
    .map((c) => ({ ...c, busy: false, streaming: undefined, items: settle(c.items).slice(-MAX_ITEMS) }));
  return { ...convs, all };
}

export function saveConversations(root: string, convs: Conversations) {
  const chats = stored();
  const kept = keptConversations(convs);
  if (kept.all.length === 0) delete chats[root];
  else chats[root] = kept;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch {
    // Storage full or unavailable: the conversations last while the window is open.
  }
}

/* ---------- the backend ---------- */

/** Where Claude Code is installed, or null. */
export const detectAssistant = () => invoke<string | null>("ai_detect");

/** Sends a message; the assistant's events (JSON lines) go to `onEvent`. */
export function sendToAssistant(
  message: string,
  session: string | null,
  scope: Scope,
  notesFolder: string,
  onEvent: (line: string) => void,
) {
  const channel = new Channel<string>();
  channel.onmessage = onEvent;
  return invoke<void>("ai_send", { message, session, scope, notesFolder, onEvent: channel });
}

/** The folders open in the other windows. */
export const otherProjects = () => invoke<string[]>("ai_projects");

/** Answers its request to write a file. */
export const answerAssistant = (requestId: string, allow: boolean) => invoke<void>("ai_answer", { requestId, allow });

/** Stops the answer on its way; the next message resumes the conversation. */
export const stopAssistant = () => invoke<void>("ai_stop");

export const INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash";
