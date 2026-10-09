import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  FilePen,
  FilePlus2,
  FileText,
  History,
  MessageSquare,
  PanelRightClose,
  Search,
  ShieldQuestion,
  Sparkles,
  SquarePen,
  Square,
  X,
} from "lucide-react";
import {
  answerAssistant,
  closeConversation,
  composeMessage,
  decide,
  describeTool,
  detectAssistant,
  documentsToShare,
  EMPTY_CHAT,
  forgetConversation,
  history,
  INSTALL_COMMAND,
  lineDiff,
  loadConversations,
  newConversation,
  openConversation,
  otherProjects,
  reduce,
  saveConversations,
  sendToAssistant,
  stopAssistant,
  titleFor,
  turns,
  writesFiles,
  type Chat,
  type ChatItem,
  type Conversation,
  type Conversations,
  type DiffLine,
  type PermissionRequest,
  type Scope,
  type ToolUse,
} from "../lib/ai";
import { api } from "../lib/api";
import { BlockRenderer } from "../lib/blockRenderer";
import { basename, isInside, isMarkdown, relative, resolve, splitLink } from "../lib/paths";
import { useStoredState } from "../lib/useStoredState";
import type { LicenseStatus } from "../lib/license";
import { ProOffer } from "./License";

interface AiChatProps {
  /** The window's open folder: what the chat is about. */
  root: string;
  /** The document being read, if any. */
  activePath: string | null;
  /** The documents open in the window's tabs, with their unsaved changes: what the "Open files" scope reads. */
  openDocuments: () => { path: string; content: string }[];
  /** Text selected in the document to ask about, until it's sent or dropped. */
  quote: { text: string; n: number } | null;
  onDropQuote: () => void;
  /** Where the assistant writes, relative to the folder. */
  notesFolder: string;
  /** Saves a question and its answer as a note in the project. */
  onSaveNote: (turn: { question: string; quote?: string; answer: string }) => void;
  /** Whether a document has changes not saved yet, which a change from the assistant would conflict with. */
  isUnsaved: (path: string) => boolean;
  /** Mido Pro's license: without it, the panel offers it instead of the chat. */
  license: LicenseStatus;
  onLicense: (status: LicenseStatus) => void;
  onOpenFile: (path: string, anchor?: string) => void;
  onClose: () => void;
}

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

const SCOPES: { id: Scope; label: string; title: string }[] = [
  { id: "openFiles", label: "Open files", title: "Only the documents open in tabs, unsaved changes included" },
  { id: "project", label: "Project", title: "Every file in this folder" },
  { id: "allProjects", label: "All projects", title: "Every folder open in Mido's windows" },
];

/** What's usually asked about a passage, sent with one click. */
const QUICK_ASKS = [
  { label: "Explain", text: "Explain this passage." },
  { label: "Simplify", text: "Say this more simply." },
  { label: "Summarize", text: "Summarize this passage in a few points." },
];

/**
 * Chats about the open folder's documents with Claude Code, installed on the
 * computer (src-tauri/src/ai.rs). Several conversations per folder: the open
 * ones in a list in the header, the closed ones in the history, shown when
 * none is open. Kept per folder, and resumed when it opens again.
 */
export default function AiChat(props: AiChatProps) {
  const { root, activePath, openDocuments, quote, onDropQuote, notesFolder, onSaveNote, isUnsaved, onOpenFile, onClose } = props;
  // Conversations whose changes are all allowed without asking ("Allow all in this chat").
  const [allowAll, setAllowAll] = useState<Set<string>>(() => new Set());
  const [scope, setScope] = useStoredState<Scope>("mido.aiScope", "project", { shared: true });
  // The folders "All projects" adds, shown in its tooltip.
  const [others, setOthers] = useState<string[]>([]);
  // undefined: still looking for it.
  const [program, setProgram] = useState<string | null | undefined>(undefined);
  const [convs, setConvs] = useState<Conversations>(() => loadConversations(root));
  const current = convs.all.find((c) => c.id === convs.active) ?? null;
  const chat: Chat = current ?? EMPTY_CHAT;
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Following the answer: scrolled to the bottom, until the user scrolls up.
  const following = useRef(true);

  const detect = useCallback(() => {
    setProgram(undefined);
    detectAssistant().then(setProgram, () => setProgram(null));
  }, []);
  useEffect(detect, [detect]);

  /** Changes the conversation `id`'s chat. */
  const update = useCallback((id: string, change: (chat: Chat) => Chat) => {
    setConvs((cs) => ({ ...cs, all: cs.all.map((c) => (c.id === id ? { ...c, ...change(c) } : c)) }));
  }, []);

  // The files it wrote that were opened: each opens once, when it's written (not when the chat is shown again).
  const opened = useRef<Set<string> | null>(null);
  if (!opened.current) opened.current = toolIds(convs.all.flatMap((c) => c.items));

  // Another folder: its own conversations. The answer on its way for the last one stops.
  const shownRoot = useRef(root);
  useEffect(() => {
    if (shownRoot.current === root) return;
    shownRoot.current = root;
    void stopAssistant().catch(() => {});
    const next = loadConversations(root);
    opened.current = toolIds(next.all.flatMap((c) => c.items));
    setConvs(next);
    setMenuOpen(false);
  }, [root]);

  /** The user's answer to a request to write. */
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
    if (!busy && shownRoot.current === root) saveConversations(root, convs);
  }, [busy, convs, root]);

  // Stops the answer when the panel closes.
  useEffect(() => () => void stopAssistant().catch(() => {}), []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && following.current) list.scrollTop = list.scrollHeight;
  }, [chat.items, convs.active]);

  // Ready to ask: when it's found, for each passage picked, and in each conversation shown.
  useEffect(() => inputRef.current?.focus(), [program, quote?.n, convs.active]);

  const send = (asked = draft) => {
    const text = asked.trim();
    if (!text || chat.busy) return;
    // Nothing open: a new conversation.
    const conv = current ?? newConversation();
    const document = activePath ? relative(root, activePath) : undefined;
    const open = openDocuments().map((d) => ({ path: relative(root, d.path), content: d.content }));
    const share = scope === "openFiles" ? documentsToShare(open, conv.shared) : null;
    const message = composeMessage(text, {
      document,
      quote: quote?.text,
      open: share ? open.map((d) => d.path) : undefined,
      documents: share?.documents,
    });
    const forRoot = root;
    const item: ChatItem = quote ? { kind: "user", text, quote: quote.text } : { kind: "user", text };
    setDraft("");
    onDropQuote();
    following.current = true;
    setConvs((cs) => {
      const all = cs.all.some((c) => c.id === conv.id) ? cs.all : [...cs.all, conv];
      return openConversation(
        {
          ...cs,
          all: all.map((c) =>
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
          ),
        },
        conv.id,
      );
    });
    sendToAssistant(message, conv.session, scope, notesFolder, (line) => {
      if (shownRoot.current === forRoot) update(conv.id, (c) => reduce(c, line));
    }).catch((e) => update(conv.id, (c) => ({ ...c, busy: false, items: [...c.items, { kind: "error", text: String(e) }] })));
  };

  const stop = () => {
    for (const c of convs.all) if (c.busy) update(c.id, (chat) => ({ ...chat, busy: false, streaming: undefined }));
    void stopAssistant().catch(() => {});
  };

  /** A new, empty conversation (or the empty one already open). */
  const newChat = () => {
    setMenuOpen(false);
    const empty = convs.all.find((c) => convs.open.includes(c.id) && c.items.length === 0);
    if (empty) setConvs((cs) => openConversation(cs, empty.id));
    else {
      const conv = newConversation();
      setConvs((cs) => openConversation({ ...cs, all: [...cs.all, conv] }, conv.id));
    }
    inputRef.current?.focus();
  };

  const show = (id: string) => {
    setMenuOpen(false);
    setConvs((cs) => openConversation(cs, id));
  };

  const close = (id: string) => {
    if (convs.all.find((c) => c.id === id)?.busy) stop();
    setConvs((cs) => closeConversation(cs, id));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape" && chat.busy) {
      e.preventDefault();
      stop();
    }
  };

  // Changes it asked about show as their request, not as a tool line too.
  const asked = new Set(chat.items.flatMap((i) => (i.kind === "permission" ? [i.toolUseId] : [])));

  // Where each answered turn ends, for its actions (the one on its way has none yet).
  const turnEnds = new Map<number, ReturnType<typeof turns>[number]>();
  const all = turns(chat.items);
  all.forEach((turn, n) => {
    const end = n + 1 < all.length ? all[n + 1].at - 1 : chat.items.length - 1;
    const answering = chat.busy && n === all.length - 1;
    if (turn.answer && !answering) turnEnds.set(end, turn);
  });

  /** Links in answers: files in the folder open in Mido, web pages in the browser. */
  const followLink = (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest?.("a");
    const href = link?.getAttribute("href");
    if (!link || !href) return;
    e.preventDefault();
    if (EXTERNAL.test(href)) return void openUrl(href).catch(console.error);
    const { path, anchor } = splitLink(href);
    if (!path) return;
    const target = resolve(root, path.replace(/^\//, ""));
    if (isMarkdown(target)) onOpenFile(target, anchor || undefined);
    else void revealItemInDir(target).catch(console.error);
  };

  const licensed = props.license.active;
  const past = history(convs);
  const openConvs = convs.open.flatMap((id) => convs.all.filter((c) => c.id === id));
  return (
    <aside className="outline ai-chat" aria-label="Assistant">
      <header className="outline-header">
        {licensed && (current || past.length > 0) ? (
          <ConversationMenu
            title={current ? current.title || "New chat" : "History"}
            open={menuOpen}
            onToggle={() => setMenuOpen((o) => !o)}
            onDismiss={() => setMenuOpen(false)}
            openConvs={openConvs}
            past={past}
            active={convs.active}
            onShow={show}
            onClose={close}
            onNew={newChat}
          />
        ) : (
          <span>Assistant</span>
        )}
        <span className="comments-actions">
          {licensed && (
            <button className="icon-button" onClick={newChat} title="New chat">
              <SquarePen size={14} />
            </button>
          )}
          {licensed && current && (
            <button className="icon-button" onClick={() => close(current.id)} title="Close this chat (it stays in the history)">
              <PanelRightClose size={14} />
            </button>
          )}
          <button className="icon-button" onClick={onClose} title="Close the assistant">
            <X size={14} />
          </button>
        </span>
      </header>
      {licensed && (
        <div className="segmented ai-chat-scope" role="radiogroup" aria-label="What the assistant reads">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={scope === s.id}
              className={scope === s.id ? "selected" : ""}
              onMouseEnter={() => s.id === "allProjects" && void otherProjects().then(setOthers, () => {})}
              onClick={() => setScope(s.id)}
              title={
                s.id === "allProjects"
                  ? `${s.title}: ${[basename(root), ...others.map(basename)].join(", ")}`
                  : s.title
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {!licensed ? (
        <ProOffer status={props.license} onChange={props.onLicense} />
      ) : program === null ? (
        <NotInstalled onRetry={detect} />
      ) : (
        <>
          <div
            className="ai-chat-list"
            ref={listRef}
            onClick={followLink}
            onScroll={(e) => {
              const list = e.currentTarget;
              following.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
            }}
          >
            {!current && past.length > 0 ? (
              <HistoryList
                past={past}
                onShow={show}
                onForget={(id) => setConvs((cs) => forgetConversation(cs, id))}
              />
            ) : chat.items.length === 0 ? (
              <div className="outline-empty ai-chat-empty">
                <Sparkles size={18} />
                <span>
                  Ask Claude about the documents in <b>{basename(root)}</b>: to explain them, find something, or
                  compare them.
                </span>
              </div>
            ) : (
              chat.items.map((item, i) => {
                const turn = turnEnds.get(i);
                return (
                  <Fragment key={"key" in item ? item.key : i}>
                    {item.kind === "permission" ? (
                      <Permission
                        request={item}
                        root={root}
                        isUnsaved={isUnsaved}
                        onAnswer={(allow) => current && answer(current.id, item.requestId, allow)}
                        onAllowAll={() => current && setAllowAll((a) => new Set(a).add(current.id))}
                        onOpenFile={onOpenFile}
                      />
                    ) : item.kind === "tool" && asked.has(item.id) ? null : (
                      <Item item={item} root={root} onOpenFile={onOpenFile} />
                    )}
                    {turn && (
                      <div className="ai-chat-turn-actions">
                        <button onClick={() => onSaveNote(turn)} title={`Save the question and its answer in ${notesFolder}/`}>
                          <FilePlus2 size={12} />
                          <span>Save as note</span>
                        </button>
                      </div>
                    )}
                  </Fragment>
                );
              })
            )}
            {chat.busy && <div className="ai-chat-thinking" aria-label="Answering" />}
          </div>
          <div className="ai-chat-composer">
            {quote && (
              <div className="ai-chat-quote">
                <blockquote>{quote.text}</blockquote>
                <button className="icon-button" onClick={onDropQuote} title="Don't ask about this passage">
                  <X size={12} />
                </button>
                {!draft.trim() && !chat.busy && program && (
                  <div className="ai-chat-quick">
                    {QUICK_ASKS.map((q) => (
                      <button key={q.label} className="ai-chat-chip" onClick={() => send(q.text)}>
                        {q.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <textarea
              ref={inputRef}
              className="text-input"
              rows={1}
              placeholder={
                program === undefined
                  ? "Looking for Claude Code…"
                  : quote
                    ? "Ask about this passage…"
                    : current
                      ? "Ask about these documents…"
                      : "Start a new chat…"
              }
              disabled={program === undefined}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {chat.busy ? (
              <button className="ai-chat-send" onClick={stop} title="Stop (Esc)">
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button className="ai-chat-send" onClick={() => send()} disabled={!draft.trim() || !program} title="Send (↩)">
                <ArrowUp size={14} />
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 hours ago", "yesterday". */
function ago(ms: number): string {
  const seconds = (ms - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return relativeTime.format(Math.round(seconds / size), unit);
  return "just now";
}

/** The conversation shown, in the header: a list of the open ones and the latest closed, to switch. */
function ConversationMenu(props: {
  title: string;
  open: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  openConvs: Conversation[];
  past: Conversation[];
  active: string | null;
  onShow: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { open, onDismiss } = props;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onDismiss();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onDismiss();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onDismiss]);

  const count = props.openConvs.length;
  return (
    <div className="ai-chat-switcher" ref={ref}>
      <button className={`ai-chat-switcher-button ${open ? "active" : ""}`} onClick={props.onToggle} title="Switch chat">
        <span>{props.title}</span>
        {count > 1 && <span className="outline-count">{count}</span>}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="context-menu ai-chat-menu" role="menu">
          {count > 0 && <div className="ai-chat-menu-section">Open</div>}
          {props.openConvs.map((c) => (
            <div key={c.id} className={`ai-chat-menu-row ${c.id === props.active ? "active" : ""}`}>
              <button className="menu-item" role="menuitem" onClick={() => props.onShow(c.id)}>
                {c.busy ? <span className="ai-chat-menu-dot" /> : <MessageSquare size={13} />}
                <span className="ai-chat-menu-title">{c.title || "New chat"}</span>
                <span className="menu-hint">{c.items.length ? ago(c.updated) : ""}</span>
              </button>
              <button className="ai-chat-menu-close" title="Close (it stays in the history)" onClick={() => props.onClose(c.id)}>
                <X size={12} />
              </button>
            </div>
          ))}
          {props.past.length > 0 && <div className="ai-chat-menu-section">Recent</div>}
          {props.past.slice(0, 8).map((c) => (
            <button key={c.id} className="menu-item" role="menuitem" onClick={() => props.onShow(c.id)}>
              <History size={13} />
              <span className="ai-chat-menu-title">{c.title || "Chat"}</span>
              <span className="menu-hint">{ago(c.updated)}</span>
            </button>
          ))}
          <div className="ai-chat-menu-sep" />
          <button className="menu-item" role="menuitem" onClick={props.onNew}>
            <SquarePen size={13} />
            <span>New chat</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** With no chat open: the latest ones, to pick one up again. */
function HistoryList(props: { past: Conversation[]; onShow: (id: string) => void; onForget: (id: string) => void }) {
  return (
    <div className="recents ai-chat-history">
      <h2>Recent chats</h2>
      {props.past.map((c) => (
        <div key={c.id} className="recent-row">
          <button className="recent" onClick={() => props.onShow(c.id)} title={c.title}>
            <span className="recent-name">{c.title || "Chat"}</span>
            <span className="recent-path">{ago(c.updated)}</span>
          </button>
          <button className="recent-remove" title="Remove from the history" aria-label="Remove from the history" onClick={() => props.onForget(c.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

const toolIds = (items: ChatItem[]) => new Set(items.flatMap((i) => (i.kind === "tool" ? [i.id] : [])));

function Item({ item, root, onOpenFile }: { item: ChatItem; root: string; onOpenFile: (path: string) => void }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="ai-chat-user">
          {item.quote && <blockquote>{item.quote}</blockquote>}
          {item.text}
        </div>
      );
    case "text":
      return <Answer text={item.text} />;
    case "tool":
      return <Tool tool={item} root={root} onOpenFile={onOpenFile} />;
    case "permission":
      return null;
    case "error":
      return (
        <div className="ai-chat-error">
          <CircleAlert size={13} />
          <span>{item.text}</span>
        </div>
      );
  }
}

/** Text from the assistant, as Markdown, sanitized as the preview's is. */
function Answer({ text }: { text: string }) {
  const [renderer] = useState(() => new BlockRenderer());
  let body;
  try {
    body = renderer.render(text);
  } catch {
    body = <p>{text}</p>;
  }
  return <div className="markdown ai-chat-answer">{body}</div>;
}

/** A file it read, a search: one quiet line. */
function Tool({ tool, root, onOpenFile }: { tool: ToolUse; root: string; onOpenFile: (path: string) => void }) {
  const { verb, detail, path } = describeTool(tool, root);
  const Icon = writesFiles(tool) ? FilePen : tool.name === "Read" ? FileText : Search;
  return (
    <div className={`ai-chat-tool ${tool.status}`}>
      <Icon size={12} />
      <span>{verb}</span>
      {path && isMarkdown(path) ? (
        <button className="ai-chat-tool-file" onClick={() => onOpenFile(path)} title={`Open ${detail}`}>
          {detail}
        </button>
      ) : (
        <span className="ai-chat-tool-detail">{detail}</span>
      )}
    </div>
  );
}

/** The most diff lines shown for a change; the rest are counted. */
const MAX_DIFF_LINES = 200;

/** It asks to write a file outside its notes folder: the change, and Allow or Decline. */
function Permission(props: {
  request: PermissionRequest;
  root: string;
  isUnsaved: (path: string) => boolean;
  onAnswer: (allow: boolean) => void;
  onAllowAll: () => void;
  onOpenFile: (path: string) => void;
}) {
  const { request, root } = props;
  const input = useMemo(() => JSON.parse(request.input) as Record<string, string>, [request.input]);
  const path = input.file_path ?? "";
  const shown = isInside(root, path) ? relative(root, path) : path;
  // For a whole file: what's there now, if anything (null: nothing, undefined: still reading).
  const [current, setCurrent] = useState<string | null | undefined>(request.name === "Write" ? undefined : null);
  useEffect(() => {
    if (request.name !== "Write") return;
    if (!isInside(root, path)) return setCurrent(null);
    api.readFile(path).then(setCurrent, () => setCurrent(null));
  }, [request.name, root, path]);

  const lines: DiffLine[] = useMemo(() => {
    if (request.name === "Edit") return lineDiff(input.old_string ?? "", input.new_string ?? "");
    if (current === undefined) return [];
    if (current === null) return (input.content ?? "").split("\n").map((text) => ({ type: "+" as const, text }));
    return lineDiff(current, input.content ?? "");
  }, [request.name, input, current]);

  const verb = request.name === "Edit" ? "edit" : current ? "replace" : "create";
  const pending = request.status === "pending";
  return (
    <div className={`ai-chat-permission ${request.status}`}>
      <div className="ai-chat-permission-title">
        <ShieldQuestion size={13} />
        <span>
          {pending ? "Claude wants to " : request.status === "allowed" ? "Allowed to " : "Asked to "}
          {verb}{" "}
          {isMarkdown(path) && isInside(root, path) ? (
            <button className="ai-chat-tool-file" onClick={() => props.onOpenFile(path)}>
              {shown}
            </button>
          ) : (
            <code>{shown}</code>
          )}
        </span>
      </div>
      {pending && props.isUnsaved(path) && (
        <div className="ai-chat-permission-note">It has changes you haven't saved: save them first, or they'll conflict.</div>
      )}
      <div className="ai-chat-diff">
        {lines.slice(0, MAX_DIFF_LINES).map((line, i) => (
          <div key={i} className={`ai-chat-diff-line ${line.type === "+" ? "add" : line.type === "-" ? "del" : line.type === "…" ? "gap" : ""}`}>
            <span>{line.type === "…" ? "⋯" : line.type}</span>
            <code>{line.text || " "}</code>
          </div>
        ))}
        {lines.length > MAX_DIFF_LINES && <div className="ai-chat-diff-more">{lines.length - MAX_DIFF_LINES} more lines</div>}
      </div>
      {pending ? (
        <div className="ai-chat-permission-actions">
          <button className="ai-chat-allow" onClick={() => props.onAnswer(true)}>
            <Check size={12} />
            Allow
          </button>
          <button onClick={() => props.onAnswer(false)}>Decline</button>
          <button className="ai-chat-allow-all" onClick={props.onAllowAll} title="Allow this and the next changes in this chat">
            Allow all in this chat
          </button>
        </div>
      ) : (
        request.status !== "allowed" && (
          <div className="ai-chat-permission-status">{request.status === "declined" ? "Declined" : "Not answered"}</div>
        )
      )}
    </div>
  );
}

function NotInstalled({ onRetry }: { onRetry: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="outline-empty ai-chat-empty">
      <Sparkles size={18} />
      <span>
        The assistant is Claude Code, installed on this computer. Install it from the terminal, then sign in by running{" "}
        <code>claude</code> once:
      </span>
      <button
        className="ai-chat-install"
        title="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(INSTALL_COMMAND);
          setCopied(true);
        }}
      >
        <code>{INSTALL_COMMAND}</code>
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
      <button className="ghost-button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
