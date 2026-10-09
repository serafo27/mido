import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArrowUp, CircleAlert, FilePen, FilePlus2, FileText, Search, Sparkles, SquarePen, Square, X } from "lucide-react";
import {
  composeMessage,
  describeTool,
  detectAssistant,
  documentsToShare,
  EMPTY_CHAT,
  INSTALL_COMMAND,
  loadChat,
  otherProjects,
  reduce,
  saveChat,
  sendToAssistant,
  stopAssistant,
  turns,
  writesFiles,
  type Chat,
  type ChatItem,
  type Scope,
  type ToolUse,
} from "../lib/ai";
import { BlockRenderer } from "../lib/blockRenderer";
import { basename, isMarkdown, relative, resolve, splitLink } from "../lib/paths";
import { useStoredState } from "../lib/useStoredState";

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
 * A chat about the open folder's documents with Claude Code, installed on the
 * computer (src-tauri/src/ai.rs). One conversation per folder, resumed when
 * the folder opens again.
 */
export default function AiChat(props: AiChatProps) {
  const { root, activePath, openDocuments, quote, onDropQuote, notesFolder, onSaveNote, onOpenFile, onClose } = props;
  const [scope, setScope] = useStoredState<Scope>("mido.aiScope", "project", { shared: true });
  // The folders "All projects" adds, shown in its tooltip.
  const [others, setOthers] = useState<string[]>([]);
  // undefined: still looking for it.
  const [program, setProgram] = useState<string | null | undefined>(undefined);
  const [chat, setChat] = useState<Chat>(() => loadChat(root));
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Following the answer: scrolled to the bottom, until the user scrolls up.
  const following = useRef(true);

  const detect = useCallback(() => {
    setProgram(undefined);
    detectAssistant().then(setProgram, () => setProgram(null));
  }, []);
  useEffect(detect, [detect]);

  // The files it wrote that were opened: each opens once, when it's written (not when the chat is shown again).
  const opened = useRef<Set<string> | null>(null);
  if (!opened.current) opened.current = toolIds(chat.items);

  // Another folder: its own conversation. The answer on its way for the last one stops.
  const shownRoot = useRef(root);
  useEffect(() => {
    if (shownRoot.current === root) return;
    shownRoot.current = root;
    void stopAssistant().catch(() => {});
    const next = loadChat(root);
    opened.current = toolIds(next.items);
    setChat(next);
  }, [root]);

  // A document it wrote opens, to see it.
  useEffect(() => {
    for (const item of chat.items) {
      if (item.kind !== "tool" || !writesFiles(item) || item.status !== "done" || opened.current!.has(item.id)) continue;
      opened.current!.add(item.id);
      const { path } = describeTool(item, root);
      if (path && isMarkdown(path)) onOpenFile(path);
    }
  }, [chat.items, root, onOpenFile]);

  // Kept once each answer is done.
  useEffect(() => {
    if (!chat.busy && shownRoot.current === root) saveChat(root, chat);
  }, [chat, root]);

  // Stops the answer when the panel closes.
  useEffect(() => () => void stopAssistant().catch(() => {}), []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && following.current) list.scrollTop = list.scrollHeight;
  }, [chat.items]);

  // Ready to ask: when it's found, and for each passage picked.
  useEffect(() => inputRef.current?.focus(), [program, quote?.n]);

  const send = (asked = draft) => {
    const text = asked.trim();
    if (!text || chat.busy) return;
    const document = activePath ? relative(root, activePath) : undefined;
    const open = openDocuments().map((d) => ({ path: relative(root, d.path), content: d.content }));
    const share = scope === "openFiles" ? documentsToShare(open, chat.shared) : null;
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
    setChat((c) => ({ ...c, busy: true, shared: share?.shared ?? c.shared, items: [...c.items, item] }));
    sendToAssistant(message, chat.session, scope, notesFolder, (line) => {
      if (shownRoot.current === forRoot) setChat((c) => reduce(c, line));
    }).catch((e) =>
      setChat((c) => ({ ...c, busy: false, items: [...c.items, { kind: "error", text: String(e) }] })),
    );
  };

  const stop = () => {
    setChat((c) => ({ ...c, busy: false, streaming: undefined }));
    void stopAssistant().catch(() => {});
  };

  const newChat = () => {
    void stopAssistant().catch(() => {});
    setChat(EMPTY_CHAT);
    inputRef.current?.focus();
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

  return (
    <aside className="outline ai-chat" aria-label="Assistant">
      <header className="outline-header">
        <span>Assistant</span>
        <span className="comments-actions">
          <button className="icon-button" onClick={newChat} title="New chat" disabled={chat.items.length === 0}>
            <SquarePen size={14} />
          </button>
          <button className="icon-button" onClick={onClose} title="Close the assistant">
            <X size={14} />
          </button>
        </span>
      </header>
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

      {program === null ? (
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
            {chat.items.length === 0 ? (
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
                    <Item item={item} root={root} onOpenFile={onOpenFile} />
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
                program === undefined ? "Looking for Claude Code…" : quote ? "Ask about this passage…" : "Ask about these documents…"
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
