import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  CloudUpload,
  FileSymlink,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { api, type GitCommit, type GitFileChange, type GitRepo } from "../lib/api";
import { basename, dirname, tildify } from "../lib/paths";
import { changeLetter } from "../lib/useGit";
import { isMac } from "../lib/platform";

/** A file to show in a diff tab, from the changes or from a commit. */
export type DiffTarget =
  | { kind: "unstaged" | "staged"; change: GitFileChange }
  | { kind: "commit"; change: GitFileChange; commit: GitCommit }
  | { kind: "conflict"; change: GitFileChange };

export const diffKey = (t: DiffTarget) => `${t.kind}:${t.kind === "commit" ? t.commit.hash : ""}:${t.change.path}`;

interface SourceControlProps {
  /** Hidden rather than unmounted, so the commit message survives switching views. */
  visible: boolean;
  repo: GitRepo | null;
  /** The git action running ("Pushing…"); the buttons wait for it. */
  busy: string | null;
  /** Local paths of files with edits not saved to disk yet: git can't see those. */
  unsaved: Set<string>;
  /** The diff in the active tab, to highlight its file. */
  activeDiff: string | null;
  /** What went wrong in the last git action, as git explained it. */
  error: string | null;
  onDismissError: () => void;
  onTrust: () => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  /** Resolves to true once committed, so the message can be cleared. */
  onCommit: (message: string) => Promise<boolean>;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onContinue: () => void;
  onAbort: () => void;
  /** A single click opens a preview tab; a double click, a tab that stays. */
  onOpenDiff: (target: DiffTarget, pin?: boolean) => void;
  onOpenFile: (path: string) => void;
}

const HISTORY_SIZE = 50;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function SourceControl(props: SourceControlProps) {
  const { repo, busy } = props;
  const status = repo?.status ?? null;
  const [message, setMessage] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  // The message box grows with what's typed, as VS Code's does.
  useEffect(() => {
    const box = input.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 200)}px`;
  }, [message, props.visible]);

  if (!props.visible) return null;

  const title = (actions?: ReactNode) => (
    <div className="scm-title">
      <span>Source Control</span>
      <span className="spacer" />
      {actions}
    </div>
  );

  if (!repo) {
    return (
      <div className="scm">
        {title()}
        <p className="scm-empty">This folder isn't in a git repository.</p>
      </div>
    );
  }

  if (!repo.trusted || !status) {
    return (
      <div className="scm">
        {title()}
        <div className="scm-trust">
          <ShieldCheck size={20} />
          <p>
            This folder is in the git repository <strong>{tildify(repo.root)}</strong>.
          </p>
          <p className="muted">
            Mido can show its changes and history, and commit, push and pull when you ask. Git runs as it does in
            Terminal, with the repository's hooks and settings, so only allow repositories you trust.
          </p>
          <button className="scm-button" onClick={props.onTrust}>
            Use Git in This Repository
          </button>
        </div>
      </div>
    );
  }

  const conflicts = status.files.filter((f) => f.conflicted);
  const staged = status.files.filter((f) => !f.conflicted && f.staged);
  const changes = status.files.filter((f) => !f.conflicted && f.unstaged);
  const branch = status.branch ?? "detached HEAD";
  const canCommit = !busy && staged.length > 0 && message.trim() !== "" && conflicts.length === 0;
  const unpublished = status.branch !== null && !status.upstream && status.remotes.length > 0;

  const commit = async () => {
    if (!canCommit) return;
    if (await props.onCommit(message)) setMessage("");
  };
  const onMessageKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  };

  const row = (change: GitFileChange, kind: "staged" | "unstaged" | "conflict", actions: ReactNode) => {
    const target: DiffTarget = { kind, change };
    return (
      <FileRow
        key={`${kind}:${change.path}`}
        change={change}
        letter={kind === "staged" ? (change.staged === "?" ? "A" : change.staged!) : changeLetter(change)}
        active={props.activeDiff === diffKey(target)}
        unsaved={change.local !== null && props.unsaved.has(change.local)}
        onOpen={(pin) => props.onOpenDiff(target, pin)}
        actions={
          <>
            {change.local && (kind === "conflict" || change[kind === "staged" ? "staged" : "unstaged"] !== "D") && (
              <RowAction title="Open File" onClick={() => props.onOpenFile(change.local!)}>
                <FileSymlink size={14} />
              </RowAction>
            )}
            {actions}
          </>
        }
      />
    );
  };

  return (
    <div className="scm">
      {title(
        <>
          <RowAction title="Fetch" disabled={!!busy || status.remotes.length === 0} onClick={props.onFetch}>
            <RefreshCw size={14} />
          </RowAction>
          <RowAction title="Pull" disabled={!!busy || !status.upstream} onClick={props.onPull}>
            <ArrowDownToLine size={15} />
          </RowAction>
          <RowAction title={unpublished ? "Publish Branch" : "Push"} disabled={!!busy || status.remotes.length === 0 || !status.branch} onClick={props.onPush}>
            <ArrowUpFromLine size={15} />
          </RowAction>
        </>,
      )}

      <div className="scm-scroll">
        {props.error && (
          <div className="scm-notice error" role="alert">
            <pre>{props.error}</pre>
            <RowAction title="Dismiss" onClick={props.onDismissError}>
              <X size={13} />
            </RowAction>
          </div>
        )}

        {status.operation ? (
          <div className="scm-notice warning">
            <TriangleAlert size={14} />
            <div className="scm-notice-body">
              <strong>{status.operation === "merge" ? "Merge in progress" : "Rebase in progress"}</strong>
              <span>
                {conflicts.length > 0
                  ? `Resolve the conflicts in ${plural(conflicts.length, "file")}, then ${status.operation === "merge" ? "commit the merge" : "continue"}.`
                  : `Every conflict is resolved: ${status.operation === "merge" ? "commit the merge" : "continue the rebase"}.`}
              </span>
              <div className="scm-notice-actions">
                <button className="scm-button" disabled={!!busy || conflicts.length > 0} onClick={props.onContinue}>
                  <Check size={14} />
                  {status.operation === "merge" ? "Commit Merge" : "Continue Rebase"}
                </button>
                <button className="scm-button secondary" disabled={!!busy} onClick={props.onAbort}>
                  <Undo2 size={14} />
                  Abort
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="scm-commit">
            <textarea
              ref={input}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={onMessageKey}
              placeholder={`Message (${isMac ? "⌘" : "Ctrl+"}Enter to commit on “${branch}”)`}
              rows={1}
              spellCheck
            />
            <button className="scm-button" disabled={!canCommit} onClick={commit} title={staged.length === 0 ? "Stage the changes to commit first" : undefined}>
              <Check size={14} />
              Commit
            </button>
            {unpublished && (
              <button className="scm-button secondary" disabled={!!busy} onClick={props.onPush}>
                <CloudUpload size={14} />
                Publish Branch
              </button>
            )}
            {status.upstream && (status.behind > 0 || status.ahead > 0) && (
              <div className="scm-sync">
                {status.behind > 0 && (
                  <button
                    className="scm-button secondary"
                    disabled={!!busy}
                    onClick={props.onPull}
                    title={`Pull ${plural(status.behind, "commit")} from ${status.upstream}`}
                  >
                    <ArrowDownToLine size={14} />
                    Pull {status.behind}
                  </button>
                )}
                {status.ahead > 0 && (
                  <button
                    className="scm-button secondary"
                    disabled={!!busy}
                    onClick={props.onPush}
                    title={`Push ${plural(status.ahead, "commit")} to ${status.upstream}`}
                  >
                    <ArrowUpFromLine size={14} />
                    Push {status.ahead}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {busy && (
          <div className="scm-progress" role="status">
            <span className="scm-progress-bar" />
            <span className="scm-progress-label">{busy}</span>
          </div>
        )}

        {conflicts.length > 0 && (
          <Group title="Merge Changes" count={conflicts.length}>
            {conflicts.map((c) => row(c, "conflict", null))}
          </Group>
        )}
        {staged.length > 0 && (
          <Group
            title="Staged Changes"
            count={staged.length}
            actions={
              <RowAction title="Unstage All Changes" disabled={!!busy} onClick={() => props.onUnstage(staged.map((f) => f.path))}>
                <Minus size={14} />
              </RowAction>
            }
          >
            {staged.map((c) =>
              row(
                c,
                "staged",
                <RowAction title="Unstage Changes" disabled={!!busy} onClick={() => props.onUnstage([c.path])}>
                  <Minus size={14} />
                </RowAction>,
              ),
            )}
          </Group>
        )}
        <Group
          title="Changes"
          count={changes.length}
          actions={
            changes.length > 0 && (
              <RowAction title="Stage All Changes" disabled={!!busy} onClick={() => props.onStage(changes.map((f) => f.path))}>
                <Plus size={14} />
              </RowAction>
            )
          }
        >
          {changes.length === 0 && staged.length === 0 && conflicts.length === 0 ? (
            <p className="scm-empty small">No changes since the last commit.</p>
          ) : (
            changes.map((c) =>
              row(
                c,
                "unstaged",
                <RowAction title="Stage Changes" disabled={!!busy} onClick={() => props.onStage([c.path])}>
                  <Plus size={14} />
                </RowAction>,
              ),
            )
          )}
        </Group>

        <Graph
          enabled={status.hasCommits}
          branch={status.branch}
          upstream={status.upstream}
          // A new commit, pull or rebase moves HEAD: read the history again.
          version={`${status.branch}:${status.ahead}:${status.behind}:${status.files.length}:${status.operation}`}
          activeDiff={props.activeDiff}
          onOpenDiff={props.onOpenDiff}
        />
      </div>
    </div>
  );
}

function RowAction(props: { title: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className="scm-action"
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {props.children}
    </button>
  );
}

/** A collapsible list of resources, with its count and actions on the header. */
function Group(props: { title: string; count?: number; actions?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="scm-group">
      <div className="scm-group-header" onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={14} className={`chevron ${open ? "open" : ""}`} />
        <span className="scm-group-title">{props.title}</span>
        <span className="scm-group-actions">{props.actions}</span>
        {props.count !== undefined && props.count > 0 && <span className="scm-count">{props.count}</span>}
      </div>
      {open && props.children}
    </section>
  );
}

const STATUS_NAMES: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
  U: "Untracked",
  "!": "Conflict",
};

function FileRow(props: {
  change: GitFileChange;
  letter: string;
  active: boolean;
  unsaved: boolean;
  /** `pin` on a double click. */
  onOpen: (pin: boolean) => void;
  actions: ReactNode;
  indent?: boolean;
}) {
  const { change, letter } = props;
  const folder = dirname(change.path);
  const tone = letter === "!" ? "conflict" : letter;
  return (
    <div
      className={`scm-file tone-${tone} ${props.active ? "active" : ""} ${props.indent ? "indent" : ""}`}
      onClick={() => props.onOpen(false)}
      onDoubleClick={() => props.onOpen(true)}
      title={`${change.origPath ? `${change.origPath} → ` : ""}${change.path} • ${STATUS_NAMES[letter] ?? "Changed"}${props.unsaved ? " • unsaved edits not in git yet" : ""}`}
    >
      <span className="scm-file-name">{basename(change.path)}</span>
      {folder !== change.path && folder !== "" && <span className="scm-file-folder">{folder}</span>}
      <span className="scm-file-actions">{props.actions}</span>
      {props.unsaved && <span className="scm-unsaved" aria-label="Unsaved edits" />}
      <span className="scm-letter">{letter}</span>
    </div>
  );
}

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
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

/** The branch's history as a line of commits, newest first, like VS Code's source control graph. */
function Graph(props: {
  enabled: boolean;
  branch: string | null;
  upstream: string | null;
  version: string;
  activeDiff: string | null;
  onOpenDiff: (target: DiffTarget, pin?: boolean) => void;
}) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [files, setFiles] = useState<GitFileChange[]>([]);

  useEffect(() => {
    if (!props.enabled) return setCommits([]);
    let cancelled = false;
    api.gitLog(HISTORY_SIZE).then(
      (log) => !cancelled && setCommits(log),
      () => !cancelled && setCommits([]),
    );
    return () => {
      cancelled = true;
    };
  }, [props.enabled, props.version]);

  const toggle = (commit: GitCommit) => {
    if (expanded === commit.hash) return setExpanded(null);
    setExpanded(commit.hash);
    setFiles([]);
    api.gitCommitFiles(commit.hash).then(setFiles, () => setFiles([]));
  };

  return (
    <Group title="Graph">
      {!props.enabled && <p className="scm-empty small">No commits yet.</p>}
      <div className="scm-graph">
        {commits.map((commit, i) => (
          <div key={commit.hash} className={`scm-graph-item ${i === commits.length - 1 ? "last" : ""}`}>
            <div
              className={`scm-graph-row ${expanded === commit.hash ? "open" : ""}`}
              onClick={() => toggle(commit)}
              title={`${commit.subject}\n\n${commit.author}${commit.email ? ` <${commit.email}>` : ""}\n${new Date(commit.date).toLocaleString()}\n${commit.short}`}
            >
              <span className={`scm-node ${i === 0 ? "head" : ""}`} />
              <span className="scm-commit-subject">{commit.subject}</span>
              {i === 0 && props.branch && (
                <span className="scm-ref" title={props.upstream ? `Tracking ${props.upstream}` : undefined}>
                  <GitBranch size={11} />
                  {props.branch}
                </span>
              )}
              <span className="scm-commit-author">{commit.author}</span>
            </div>
            {expanded === commit.hash && (
              <div className="scm-commit-details">
                <span className="scm-commit-meta">
                  {ago(commit.date)} · <code>{commit.short}</code>
                </span>
                {files.map((change) => {
                  const target: DiffTarget = { kind: "commit", change, commit };
                  return (
                    <FileRow
                      key={change.path}
                      change={change}
                      letter={change.staged ?? "M"}
                      active={props.activeDiff === diffKey(target)}
                      unsaved={false}
                      onOpen={(pin) => props.onOpenDiff(target, pin)}
                      actions={null}
                      indent
                    />
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </Group>
  );
}
