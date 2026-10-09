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

export type ChatItem =
  | { kind: "user"; text: string; /** The text selected in the document it's about. */ quote?: string }
  | { kind: "text"; key: string; text: string }
  | ToolUse
  | { kind: "error"; text: string };

export interface Chat {
  /** The conversation to resume; null until the first answer starts one. */
  session: string | null;
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

/** Tools still running when the answer ended won't finish. */
const settle = (items: ChatItem[]) => items.map((i) => (i.kind === "tool" && i.status === "running" ? { ...i, status: "done" as const } : i));

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
    case "Grep":
      return { verb: "Searched for", detail: input.pattern ? `“${input.pattern}”` : "" };
    case "Glob":
      return { verb: "Looked for", detail: input.pattern ?? "" };
  }
  return { verb: tool.name, detail: "" };
}

/** The message sent for what the user wrote: with the document they're reading and the text they selected. */
export function composeMessage(text: string, context: { document?: string; quote?: string }): string {
  const parts: string[] = [];
  if (context.document) parts.push(`(I'm reading ${context.document} in Mido.)`);
  if (context.quote) parts.push(`About this passage:\n\n${context.quote.replace(/^/gm, "> ")}`);
  parts.push(text);
  return parts.join("\n\n");
}

/* ---------- the chats, kept per folder ---------- */

const STORAGE_KEY = "mido.aiChats";
/** The most items kept for a chat; older ones go (the assistant still remembers them). */
const MAX_ITEMS = 300;

function storedChats(): Record<string, Chat> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

/** The chat last held about `root`. */
export function loadChat(root: string): Chat {
  const chat = storedChats()[root];
  return chat ? { session: chat.session ?? null, items: chat.items ?? [], busy: false } : EMPTY_CHAT;
}

export function saveChat(root: string, chat: Chat) {
  const chats = storedChats();
  if (chat.items.length === 0) delete chats[root];
  else chats[root] = { session: chat.session, items: chat.items.slice(-MAX_ITEMS), busy: false };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch {
    // Storage full or unavailable: the chat lasts while the window is open.
  }
}

/* ---------- the backend ---------- */

/** Where Claude Code is installed, or null. */
export const detectAssistant = () => invoke<string | null>("ai_detect");

/** Sends a message; the assistant's events (JSON lines) go to `onEvent`. */
export function sendToAssistant(message: string, session: string | null, onEvent: (line: string) => void) {
  const channel = new Channel<string>();
  channel.onmessage = onEvent;
  return invoke<void>("ai_send", { message, session, onEvent: channel });
}

/** Stops the answer on its way; the next message resumes the conversation. */
export const stopAssistant = () => invoke<void>("ai_stop");

export const INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash";
