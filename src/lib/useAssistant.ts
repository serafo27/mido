// The assistant's conversations for a window's folder, and talking to it
// (src-tauri/src/ai.rs): shared by its side panel and the chats open in tabs,
// so an answer goes on wherever its conversation is shown.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  answerAssistant,
  closeConversation,
  composeMessage,
  decide,
  describeTool,
  detectAssistant,
  documentsToShare,
  forgetConversation,
  loadConversations,
  newConversation,
  openConversation,
  reduce,
  saveConversations,
  sendToAssistant,
  stopAssistant,
  titleFor,
  writesFiles,
  type Chat,
  type ChatItem,
  type Conversations,
  type Scope,
} from "./ai";
import { isMarkdown, relative } from "./paths";
import { useStoredState } from "./useStoredState";

const NO_CONVERSATIONS: Conversations = { all: [], open: [], active: null };

const toolIds = (convs: Conversations) =>
  new Set(convs.all.flatMap((c) => c.items.flatMap((i) => (i.kind === "tool" ? [i.id] : []))));

interface Options {
  /** The window's open folder; null: none, nothing to talk about. */
  root: string | null;
  /** Mido Pro is on, and the assistant offered. */
  enabled: boolean;
  /** The document being read, if any. */
  activePath: string | null;
  /** The documents in the tabs, as they are now: what the "Open files" scope reads. */
  openDocuments: () => { path: string; content: string }[];
  /** Where it writes, relative to the folder. */
  notesFolder: string;
  /** Opens a document it wrote. */
  onOpenFile: (path: string) => void;
}

export type Assistant = ReturnType<typeof useAssistant>;

export function useAssistant({ root, enabled, activePath, openDocuments, notesFolder, onOpenFile }: Options) {
  // undefined: still looking for it; null: not installed.
  const [program, setProgram] = useState<string | null | undefined>(undefined);
  const [scope, setScope] = useStoredState<Scope>("mido.aiScope", "project", { shared: true });
  const [convs, setConvs] = useState<Conversations>(() => (root ? loadConversations(root) : NO_CONVERSATIONS));
  // Conversations whose changes are all allowed without asking ("Allow all in this chat").
  const [allowAll, setAllowAll] = useState<Set<string>>(() => new Set());

  const detect = useCallback(() => {
    setProgram(undefined);
    detectAssistant().then(setProgram, () => setProgram(null));
  }, []);
  useEffect(() => {
    if (enabled) detect();
  }, [enabled, detect]);

  // The files it wrote that were opened: each opens once, when it's written (not when a chat is shown again).
  const opened = useRef<Set<string> | null>(null);
  if (!opened.current) opened.current = toolIds(convs);

  // Another folder: its own conversations. The answer on its way for the last one stops.
  const shownRoot = useRef(root);
  useEffect(() => {
    if (shownRoot.current === root) return;
    shownRoot.current = root;
    void stopAssistant().catch(() => {});
    const next = root ? loadConversations(root) : NO_CONVERSATIONS;
    opened.current = toolIds(next);
    setConvs(next);
    setAllowAll(new Set());
  }, [root]);

  /** Changes the conversation `id`'s chat. */
  const update = useCallback((id: string, change: (chat: Chat) => Chat) => {
    setConvs((cs) => ({ ...cs, all: cs.all.map((c) => (c.id === id ? { ...c, ...change(c) } : c)) }));
  }, []);

  /** The user's answer to its request to write. */
  const answer = useCallback(
    (id: string, requestId: string, allow: boolean) => {
      update(id, (c) => decide(c, requestId, allow));
      answerAssistant(requestId, allow).catch((e) =>
        update(id, (c) => ({ ...c, items: [...c.items, { kind: "error", text: String(e) }] })),
      );
    },
    [update],
  );

  useEffect(() => {
    for (const conv of convs.all) {
      if (!allowAll.has(conv.id)) continue;
      for (const item of conv.items) if (item.kind === "permission" && item.status === "pending") answer(conv.id, item.requestId, true);
    }
  }, [allowAll, convs.all, answer]);

  // A document it wrote opens, to see it.
  useEffect(() => {
    if (!root) return;
    for (const item of convs.all.flatMap((c) => c.items)) {
      if (item.kind !== "tool" || !writesFiles(item) || item.status !== "done" || opened.current!.has(item.id)) continue;
      opened.current!.add(item.id);
      const { path } = describeTool(item, root);
      if (path && isMarkdown(path)) onOpenFile(path);
    }
  }, [convs.all, root, onOpenFile]);

  // Kept once no answer is on its way.
  const busy = convs.all.some((c) => c.busy);
  useEffect(() => {
    if (!busy && root && shownRoot.current === root) saveConversations(root, convs);
  }, [busy, convs, root]);

  // Ends with the window's folder.
  useEffect(() => () => void stopAssistant().catch(() => {}), []);

  /**
   * Asks `text` in conversation `id`, or in a new one shown in the panel when
   * null; `quote` is the passage it's about. Resolves to the conversation's id.
   */
  const send = (id: string | null, text: string, quote?: string): string | null => {
    if (!root || !text.trim()) return null;
    const existing = id ? convs.all.find((c) => c.id === id) : undefined;
    if (existing?.busy) return null;
    const conv = existing ?? newConversation();
    const document = activePath ? relative(root, activePath) : undefined;
    const open = openDocuments().map((d) => ({ path: relative(root, d.path), content: d.content }));
    const share = scope === "openFiles" ? documentsToShare(open, conv.shared) : null;
    const message = composeMessage(text.trim(), {
      document,
      quote,
      open: share ? open.map((d) => d.path) : undefined,
      documents: share?.documents,
    });
    const item: ChatItem = quote ? { kind: "user", text: text.trim(), quote } : { kind: "user", text: text.trim() };
    setConvs((cs) => {
      const all = (cs.all.some((c) => c.id === conv.id) ? cs.all : [...cs.all, conv]).map((c) =>
        c.id === conv.id
          ? {
              ...c,
              busy: true,
              shared: share?.shared ?? c.shared,
              items: [...c.items, item],
              title: c.title || titleFor(text),
              updated: Date.now(),
            }
          : c,
      );
      // A new one shows in the panel; one already there stays where it is.
      return existing ? { ...cs, all } : openConversation({ ...cs, all }, conv.id);
    });
    const forRoot = root;
    sendToAssistant(message, conv.session, scope, notesFolder, (line) => {
      if (shownRoot.current === forRoot) update(conv.id, (c) => reduce(c, line));
    }).catch((e) => update(conv.id, (c) => ({ ...c, busy: false, items: [...c.items, { kind: "error", text: String(e) }] })));
    return conv.id;
  };

  /** Stops the answer on its way. */
  const stop = () => {
    for (const c of convs.all) if (c.busy) update(c.id, (chat) => ({ ...chat, busy: false, streaming: undefined }));
    void stopAssistant().catch(() => {});
  };

  /** A new, empty conversation in the panel (or the empty one already there). */
  const newChat = () => {
    const empty = convs.all.find((c) => convs.open.includes(c.id) && c.items.length === 0);
    if (empty) return setConvs((cs) => openConversation(cs, empty.id));
    const conv = newConversation();
    setConvs((cs) => openConversation({ ...cs, all: [...cs.all, conv] }, conv.id));
  };

  return {
    program,
    detect,
    scope,
    setScope,
    convs,
    send,
    stop,
    answer,
    newChat,
    allowAllIn: (id: string) => setAllowAll((a) => new Set(a).add(id)),
    /** Shows a conversation in the panel. */
    show: (id: string) => setConvs((cs) => openConversation(cs, id)),
    /** Closes it in the panel: it stays in the history. */
    close: (id: string) => {
      if (convs.all.find((c) => c.id === id)?.busy) stop();
      setConvs((cs) => closeConversation(cs, id));
    },
    /** Takes it out of the panel without stopping it: it's shown elsewhere (in a tab). */
    detach: (id: string) => setConvs((cs) => ({ ...closeConversation(cs, id), all: cs.all })),
    forget: (id: string) => setConvs((cs) => forgetConversation(cs, id)),
  };
}
