import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  ListChecks,
  CloudUpload,
  File,
  FileSymlink,
  FileText,
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
import { changeLetter, isDocumentPath } from "../lib/useGit";
import { isMac } from "../lib/platform";
import { useStoredState } from "../lib/useStoredState";

/** A file to show in a diff tab, from the changes or from a commit. */
export type DiffTarget =
  | { kind: "unstaged" | "staged" | "working"; change: GitFileChange }
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
  /** Shared with the commit dialog. */
  message: string;
  onMessageChange: (message: string) => void;
  onStage: (paths: string[]) => void;
  /** Throws away unstaged changes, after asking. */
  onDiscard: (paths: string[]) => void;
  onOpenBranches: () => void;
  onOpenCommitDialog: () => void;
  onOpenPushDialog: () => void;
  /** Every changed file and commit, rather than only Markdown documents. */
  showAll: boolean;
  onShowAll: () => void;
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
  const { message, onMessageChange: setMessage } = props;
  const input = useRef<HTMLTextAreaElement>(null);
  // The graph's share of the panel, as VS Code lets you drag it.
  const [graphHeight, setGraphHeight] = useStoredState("mido.scm.graphHeight", 220);
  // Folded down to its title at the bottom, as VS Code's views fold.
  const [graphOpen, setGraphOpen] = useStoredState("mido.scm.graphOpen", true);
  const panel = useRef<HTMLDivElement>(null);

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

  // Conflicts always show: they block the commit whatever the file.
  const shown = (f: GitFileChange) => props.showAll || isDocumentPath(f.path);
  const conflicts = status.files.filter((f) => f.conflicted);
  const staged = status.files.filter((f) => !f.conflicted && f.staged && shown(f));
  const changes = status.files.filter((f) => !f.conflicted && f.unstaged && shown(f));
  const hidden = status.files.filter((f) => !f.conflicted && !shown(f));
  const hiddenStaged = hidden.filter((f) => f.staged).length;
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

  const resizeGraph = (e: React.PointerEvent) => {
    e.preventDefault();
    const box = panel.current?.getBoundingClientRect();
    if (!box) return;
    const move = (ev: PointerEvent) => setGraphHeight(Math.round(Math.min(Math.max(box.bottom - ev.clientY, 60), box.height - 160)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="scm" ref={panel}>
      {title(
        <>
          <RowAction title={`Show Changes in a Window (${isMac ? "⌘K" : "Ctrl+K"})`} disabled={!!busy} onClick={props.onOpenCommitDialog}>
            <ListChecks size={15} />
          </RowAction>
          <RowAction title="Fetch" disabled={!!busy || status.remotes.length === 0} onClick={props.onFetch}>
            <RefreshCw size={14} />
          </RowAction>
          <RowAction title="Pull" disabled={!!busy || !status.upstream} onClick={props.onPull}>
            <ArrowDownToLine size={15} />
          </RowAction>
          <RowAction
            title={`${unpublished ? "Publish Branch" : "Push"}… (${isMac ? "⌘⇧K" : "Ctrl+Shift+K"})`}
            disabled={!!busy || status.remotes.length === 0 || !status.branch}
            onClick={props.onOpenPushDialog}
          >
            <ArrowUpFromLine size={15} />
          </RowAction>
        </>,
      )}

      <button className="scm-branch" onClick={props.onOpenBranches} disabled={!!busy} title="Switch, create or merge branches">
        <GitBranch size={13} />
        <span className="scm-branch-name">{branch}</span>
        {status.upstream && <span className="scm-branch-upstream">{status.upstream}</span>}
        <ChevronDown size={13} className="scm-branch-chevron" />
      </button>

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
            <button
              className="scm-button"
              disabled={!canCommit}
              onClick={commit}
              title={staged.length === 0 ? "Stage the changes to commit first" : undefined}
            >
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

        {hidden.length > 0 && (
          <div className="scm-hidden-note">
            {`${plural(hidden.length, "other file")} changed`}
            {hiddenStaged > 0 ? `, ${hiddenStaged} staged: ${hiddenStaged === 1 ? "it" : "they"}'ll be committed too.` : "."}
            <button className="link-button" onClick={props.onShowAll}>
              Show all files
            </button>
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
              <>
                <RowAction title="Discard All Changes" disabled={!!busy} onClick={() => props.onDiscard(changes.map((f) => f.path))}>
                  <Undo2 size={14} />
                </RowAction>
                <RowAction title="Stage All Changes" disabled={!!busy} onClick={() => props.onStage(changes.map((f) => f.path))}>
                  <Plus size={14} />
                </RowAction>
              </>
            )
          }
        >
          {changes.length === 0 && staged.length === 0 && conflicts.length === 0 ? (
            <p className="scm-empty small">{hidden.length ? "No Markdown changes." : "No changes since the last commit."}</p>
          ) : (
            changes.map((c) =>
              row(
                c,
                "unstaged",
                <>
                  <RowAction title="Discard Changes" disabled={!!busy} onClick={() => props.onDiscard([c.path])}>
                    <Undo2 size={14} />
                  </RowAction>
                  <RowAction title="Stage Changes" disabled={!!busy} onClick={() => props.onStage([c.path])}>
                    <Plus size={14} />
                  </RowAction>
                </>,
              ),
            )
          )}
        </Group>
      </div>

      <div className={`scm-graph-pane ${graphOpen ? "" : "closed"}`} style={graphOpen ? { height: graphHeight } : undefined}>
        {graphOpen && <div className="scm-pane-resizer" onPointerDown={resizeGraph} />}
        <Graph
          open={graphOpen}
          onToggle={() => setGraphOpen(!graphOpen)}
          enabled={status.hasCommits}
          markdownOnly={!props.showAll}
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

/** The file's kind at a glance, as VS Code shows its icon: documents, data, anything else. */
export function FileIcon({ path }: { path: string }) {
  const name = path.toLowerCase();
  const Icon = /\.(md|markdown|mdown|mkd|mdx|txt)$/.test(name) ? FileText : /\.(json|ya?ml|toml)$/.test(name) ? Braces : File;
  return <Icon size={14} className="scm-file-icon" aria-hidden />;
}

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
      <FileIcon path={change.path} />
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
  /** Folded, only the title shows. */
  open: boolean;
  onToggle: () => void;
  enabled: boolean;
  /** Only commits touching Markdown documents, and only those files in them. */
  markdownOnly: boolean;
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
    if (!props.enabled || !props.open) return setCommits([]);
    let cancelled = false;
    api.gitLog(HISTORY_SIZE, null, props.markdownOnly).then(
      (log) => !cancelled && setCommits(log),
      () => !cancelled && setCommits([]),
    );
    return () => {
      cancelled = true;
    };
  }, [props.enabled, props.open, props.version, props.markdownOnly]);

  const toggle = (commit: GitCommit) => {
    if (expanded === commit.hash) return setExpanded(null);
    setExpanded(commit.hash);
    setFiles([]);
    api.gitCommitFiles(commit.hash).then(
      (all) => setFiles(props.markdownOnly ? all.filter((f) => isDocumentPath(f.path)) : all),
      () => setFiles([]),
    );
  };

  return (
    <>
      <div className="scm-group-header" onClick={props.onToggle} aria-expanded={props.open}>
        <ChevronRight size={14} className={`chevron ${props.open ? "open" : ""}`} />
        <span className="scm-group-title">Graph</span>
        {props.markdownOnly && props.open && <span className="scm-group-note">Markdown</span>}
      </div>
      {!props.open ? null : !props.enabled ? (
        <p className="scm-empty small">No commits yet.</p>
      ) : (
        <div className="scm-graph">
          {commits.map((commit, i) => (
            <div key={commit.hash} className={`scm-graph-item ${i === commits.length - 1 ? "last" : ""}`}>
              <div
                className={`scm-graph-row ${expanded === commit.hash ? "open" : ""}`}
                onClick={() => toggle(commit)}
                title={`${commit.subject}\n\n${commit.author}${commit.email ? ` <${commit.email}>` : ""}\n${new Date(commit.date).toLocaleString()}\n${commit.short}`}
              >
                <span className={`scm-node ${i === 0 ? "head" : ""}`} />
                {/* The message first, as VS Code shows it: the author is in the details and the tooltip. */}
                <span className="scm-commit-subject">{commit.subject}</span>
                {i === 0 && props.branch && (
                  <span className="scm-ref" title={props.upstream ? `Tracking ${props.upstream}` : undefined}>
                    <GitBranch size={11} />
                    {props.branch}
                  </span>
                )}
              </div>
              {expanded === commit.hash && (
                <div className="scm-commit-details">
                  <span className="scm-commit-meta">
                    {commit.author} · {ago(commit.date)} · <code>{commit.short}</code>
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
      )}
    </>
  );
}
