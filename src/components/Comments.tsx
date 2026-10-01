import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ListChecks, MessageSquare, MessageSquarePlus, RotateCcw, Trash2, X } from "lucide-react";
import { sameAuthor, type Author, type Range, type Thread } from "../lib/comments";
import { altKey, modKey } from "../lib/platform";

export interface PlacedThread {
  thread: Thread;
  /** Where its text is now; null if it's gone from the document. */
  range: Range | null;
}

interface CommentsProps {
  /** In document order. */
  threads: PlacedThread[];
  activeId: string | null;
  /** Text picked for a new comment, waiting for its first message. */
  draft: { quote: string } | null;
  /** Who comments are signed by: null when git has no user, so a name is asked for. */
  author: Author | null;
  /** The web version only shows comments. */
  readOnly: boolean;
  onSelect: (id: string) => void;
  /** The mouse is over a thread's card (its id), or none (null). */
  onHover: (id: string | null) => void;
  onNewComment: () => void;
  /** `name` is given when the author had to type one. */
  onSubmitDraft: (body: string, name?: string) => void;
  onCancelDraft: () => void;
  onReply: (threadId: string, body: string, name?: string) => void;
  onResolve: (threadId: string) => void;
  onReopen: (threadId: string) => void;
  onDelete: (threadId: string, commentId: string) => void;
  onClose: () => void;
}

export default function Comments(props: CommentsProps) {
  const { threads, activeId, draft, author, readOnly } = props;
  const [showResolved, setShowResolved] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const open = threads.filter((t) => !t.thread.resolved);
  const placed = open.filter((t) => t.range);
  const detached = open.filter((t) => !t.range);
  const resolved = threads.filter((t) => t.thread.resolved);

  // Bring the selected thread into view, e.g. after clicking its highlight.
  useEffect(() => {
    const list = listRef.current;
    const card = list?.querySelector<HTMLElement>(".comment-thread.active");
    if (!list || !card) return;
    const top = card.offsetTop;
    const bottom = top + card.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - 8;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = Math.min(top - 8, bottom - list.clientHeight + 8);
  }, [activeId]);

  const card = (t: PlacedThread) => (
    <ThreadCard
      key={t.thread.id}
      placed={t}
      active={t.thread.id === activeId}
      author={author}
      readOnly={readOnly}
      onSelect={() => props.onSelect(t.thread.id)}
      onHover={(over) => props.onHover(over ? t.thread.id : null)}
      onReply={(body, name) => props.onReply(t.thread.id, body, name)}
      onResolve={() => props.onResolve(t.thread.id)}
      onReopen={() => props.onReopen(t.thread.id)}
      onDelete={(commentId) => props.onDelete(t.thread.id, commentId)}
    />
  );

  return (
    <aside className="outline comments" aria-label="Comments">
      <header className="outline-header">
        <span>Comments</span>
        {open.length > 0 && <span className="outline-count">{open.length}</span>}
        <span className="comments-actions">
          {!readOnly && (
            <button
              className="icon-button"
              // Keep the selection that the new comment is about.
              onMouseDown={(e) => e.preventDefault()}
              onClick={props.onNewComment}
              title={`Comment on the selected text (${altKey}${modKey}M)`}
            >
              <MessageSquarePlus size={14} />
            </button>
          )}
          <button
            className={`icon-button ${showResolved ? "active" : ""}`}
            onClick={() => setShowResolved((s) => !s)}
            title={showResolved ? "Hide resolved threads" : "Show resolved threads"}
          >
            <ListChecks size={14} />
          </button>
          <button className="icon-button" onClick={props.onClose} title="Close comments">
            <X size={14} />
          </button>
        </span>
      </header>
      <div className="comments-list" ref={listRef}>
        {draft && (
          <div className="comment-thread active draft">
            <blockquote className="comment-quote">{draft.quote}</blockquote>
            <Composer
              placeholder="Add a comment…"
              submitLabel="Comment"
              author={author}
              autoFocus
              onSubmit={props.onSubmitDraft}
              onCancel={props.onCancelDraft}
            />
          </div>
        )}
        {placed.map(card)}
        {detached.length > 0 && (
          <>
            <div className="comments-section" title="The text these threads were about has changed or been removed">
              Text no longer in the document
            </div>
            {detached.map(card)}
          </>
        )}
        {showResolved && resolved.length > 0 && (
          <>
            <div className="comments-section">Resolved</div>
            {resolved.map(card)}
          </>
        )}
        {!draft && open.length === 0 && (
          <div className="outline-empty">
            {readOnly ? (
              "No open comments in this document"
            ) : (
              <>
                No open comments. Select some text and press {altKey}
                {modKey}M to comment on it.
              </>
            )}
            {!showResolved && resolved.length > 0 && (
              <button className="ghost-button small" onClick={() => setShowResolved(true)}>
                Show {resolved.length} resolved
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

interface ThreadCardProps {
  placed: PlacedThread;
  active: boolean;
  author: Author | null;
  readOnly: boolean;
  onSelect: () => void;
  onHover: (over: boolean) => void;
  onReply: (body: string, name?: string) => void;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: (commentId: string) => void;
}

function ThreadCard({ placed, active, author, readOnly, ...actions }: ThreadCardProps) {
  const { thread, range } = placed;
  const classes = ["comment-thread", active && "active", thread.resolved && "resolved", !range && "detached"];
  return (
    <div
      className={classes.filter(Boolean).join(" ")}
      onMouseEnter={() => actions.onHover(true)}
      onMouseLeave={() => actions.onHover(false)}
      onClick={(e) => {
        // Clicks inside the reply box or on buttons don't move the document.
        if (!(e.target as HTMLElement).closest("textarea, input, button")) actions.onSelect();
      }}
    >
      <div className="comment-thread-top">
        <blockquote className="comment-quote">{thread.anchor.exact}</blockquote>
        {!readOnly &&
          (thread.resolved ? (
            <button className="icon-button" onClick={actions.onReopen} title="Reopen thread">
              <RotateCcw size={13} />
            </button>
          ) : (
            <button className="icon-button" onClick={actions.onResolve} title="Resolve thread">
              <Check size={14} />
            </button>
          ))}
      </div>
      {thread.comments.map((c) => (
        <div className="comment" key={c.id}>
          <div className="comment-meta">
            <Avatar author={c.author} />
            <span className="comment-author" title={c.author.email || undefined}>
              {c.author.name}
            </span>
            <time dateTime={c.at} title={new Date(c.at).toLocaleString()}>
              {timeAgo(c.at)}
            </time>
            {!readOnly && author && sameAuthor(author, c.author) && (
              <button
                className="icon-button comment-delete"
                onClick={() => actions.onDelete(c.id)}
                title={c.id === thread.comments[0]?.id ? "Delete thread" : "Delete comment"}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
          <div className="comment-body">{c.body}</div>
        </div>
      ))}
      {active && !readOnly && !thread.resolved && (
        <Composer placeholder="Reply…" submitLabel="Reply" author={author} onSubmit={actions.onReply} />
      )}
    </div>
  );
}

/** A card by the mouse over commented text: who said what, and that a click opens it. */
export function CommentPeek({ thread, x, y }: { thread: Thread; x: number; y: number }) {
  const first = thread.comments[0];
  const last = thread.comments[thread.comments.length - 1];
  if (!first) return null;
  const replies = thread.comments.length - 1;
  // Below the mouse, or above it near the bottom of the window.
  const above = y > window.innerHeight - 140;
  const left = Math.min(Math.max(x - 20, 8), window.innerWidth - 288);
  return (
    <div className={`comment-peek ${above ? "above" : ""}`} style={{ left, top: above ? y - 12 : y + 18 }}>
      <div className="comment-meta">
        <Avatar author={first.author} />
        <span className="comment-author">{first.author.name}</span>
        <time dateTime={first.at}>{timeAgo(first.at)}</time>
      </div>
      <div className="comment-peek-body">{first.body}</div>
      <div className="comment-peek-footer">
        <MessageSquare size={11} />
        {replies > 0
          ? `${replies} ${replies === 1 ? "reply" : "replies"}, last by ${last.author.name} · `
          : ""}
        Click to open
      </div>
    </div>
  );
}

interface ComposerProps {
  placeholder: string;
  submitLabel: string;
  author: Author | null;
  autoFocus?: boolean;
  onSubmit: (body: string, name?: string) => void;
  onCancel?: () => void;
}

function Composer({ placeholder, submitLabel, author, autoFocus, onSubmit, onCancel }: ComposerProps) {
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const needsName = author === null;
  const ready = body.trim() !== "" && (!needsName || name.trim() !== "");

  const submit = () => {
    if (!ready) return;
    onSubmit(body.trim(), needsName ? name.trim() : undefined);
    setBody("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="comment-composer">
      {needsName && (
        <input
          className="text-input"
          placeholder="Your name"
          title="Shown on your comments. Set a git user (git config user.name) to use that instead."
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      <textarea
        className="text-input"
        placeholder={placeholder}
        value={body}
        rows={2}
        autoFocus={autoFocus}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="comment-composer-actions">
        {onCancel && (
          <button className="ghost-button small" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="primary-button small" disabled={!ready} onClick={submit} title={`${submitLabel} (${modKey}↩)`}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function Avatar({ author }: { author: Author }) {
  const initials = author.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
  // A stable colour per person.
  let hash = 0;
  for (const ch of author.email || author.name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return (
    <span className="comment-avatar" style={{ backgroundColor: `hsl(${Math.abs(hash) % 360} 45% 52%)` }}>
      {initials || "?"}
    </span>
  );
}

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function timeAgo(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  if (!Number.isFinite(seconds)) return "";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relativeTime.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
