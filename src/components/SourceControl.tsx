import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  CloudDownload,
  FileText,
  GitBranch,
  GitCommitHorizontal,
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

/** A file to show in the diff view, from the changes or from a commit. */
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
  onOpenDiff: (target: DiffTarget) => void;
  onOpenFile: (path: string) => void;
}

const HISTORY_SIZE = 50;

export default function SourceControl(props: SourceControlProps) {
  const { repo, busy } = props;
  const status = repo?.status ?? null;
  const [message, setMessage] = useState("");

  if (!props.visible) return null;

  if (!repo) {
    return (
      <div className="git-panel">
        <p className="git-empty">This folder isn't in a git repository.</p>
      </div>
    );
  }

  if (!repo.trusted || !status) {
    return (
      <div className="git-panel">
        <div className="git-trust">
          <ShieldCheck size={22} />
          <p>
            This folder is in the git repository <strong>{tildify(repo.root)}</strong>.
          </p>
          <p className="muted">
            Mido can show its changes and history, and commit, push and pull for you. Git runs as it does in Terminal,
            with the repository's hooks and settings.
          </p>
          <button className="primary-button small" onClick={props.onTrust}>
            Use Git Here
          </button>
        </div>
      </div>
    );
  }

  const conflicts = status.files.filter((f) => f.conflicted);
  const staged = status.files.filter((f) => !f.conflicted && f.staged);
  const changes = status.files.filter((f) => !f.conflicted && f.unstaged);
  const canCommit = !busy && staged.length > 0 && message.trim() !== "" && conflicts.length === 0;

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

  const row = (change: GitFileChange, kind: "staged" | "unstaged" | "conflict", action: ReactNode) => {
    const target: DiffTarget = { kind, change };
    return (
      <FileRow
        key={`${kind}:${change.path}`}
        change={change}
        letter={kind === "staged" ? (change.staged === "?" ? "A" : change.staged!) : changeLetter(change)}
        active={props.activeDiff === diffKey(target)}
        unsaved={change.local !== null && props.unsaved.has(change.local)}
        onClick={() => props.onOpenDiff(target)}
        onOpenFile={change.local ? () => props.onOpenFile(change.local!) : undefined}
        action={action}
      />
    );
  };

  return (
    <div className="git-panel">
      <div className="git-branch-bar">
        <GitBranch size={14} />
        <span className="git-branch" title={status.upstream ? `Tracking ${status.upstream}` : "Not published yet"}>
          {status.branch ?? "Detached HEAD"}
        </span>
        {status.upstream && (status.ahead > 0 || status.behind > 0) && (
          <span className="git-sync-counts" title={`${status.ahead} to push, ${status.behind} to pull`}>
            {status.behind > 0 && (
              <>
                <ArrowDown size={11} />
                {status.behind}
              </>
            )}
            {status.ahead > 0 && (
              <>
                <ArrowUp size={11} />
                {status.ahead}
              </>
            )}
          </span>
        )}
        <span className="spacer" />
        <GitAction title="Fetch: check the remote for new commits" disabled={!!busy || status.remotes.length === 0} onClick={props.onFetch}>
          <RefreshCw size={13} />
        </GitAction>
        <GitAction title="Pull: bring in the remote's commits" disabled={!!busy || !status.upstream} onClick={props.onPull}>
          <CloudDownload size={14} />
        </GitAction>
        <GitAction
          title={status.upstream ? "Push: send your commits to the remote" : "Publish this branch"}
          disabled={!!busy || status.remotes.length === 0 || !status.branch}
          onClick={props.onPush}
        >
          <ArrowUp size={14} />
        </GitAction>
      </div>

      {props.error && (
        <div className="git-error" role="alert">
          <pre>{props.error}</pre>
          <button className="git-action" title="Dismiss" aria-label="Dismiss" onClick={props.onDismissError}>
            <X size={13} />
          </button>
        </div>
      )}

      {busy && (
        <div className="git-busy">
          <span className="update-spinner small" aria-hidden />
          {busy}
        </div>
      )}

      {status.operation && (
        <div className="git-operation">
          <TriangleAlert size={14} />
          <div>
            <strong>{status.operation === "merge" ? "Merging" : "Rebasing"}</strong>
            {conflicts.length > 0
              ? ` — resolve ${conflicts.length === 1 ? "the conflict" : `${conflicts.length} conflicts`}, then continue.`
              : " — every conflict is resolved."}
            <div className="git-operation-actions">
              <button className="ghost-button small" disabled={!!busy} onClick={props.onAbort}>
                <Undo2 size={13} />
                Abort
              </button>
              <button
                className="primary-button small"
                disabled={!!busy || conflicts.length > 0}
                onClick={props.onContinue}
              >
                {status.operation === "merge" ? "Commit Merge" : "Continue Rebase"}
              </button>
            </div>
          </div>
        </div>
      )}

      {!status.operation && (
        <div className="git-commit-box">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={onMessageKey}
            placeholder={`Message (${isMac ? "⌘" : "Ctrl+"}↵ to commit)`}
            rows={3}
            spellCheck
          />
          <button className="primary-button small git-commit-button" disabled={!canCommit} onClick={commit}>
            <Check size={14} />
            {staged.length === 0
              ? "Commit"
              : `Commit ${staged.length} ${staged.length === 1 ? "File" : "Files"}`}
          </button>
          {staged.length === 0 && changes.length > 0 && (
            <p className="git-hint">Stage the changes to commit with +.</p>
          )}
        </div>
      )}

      <div className="git-lists">
        {conflicts.length > 0 && (
          <Section title="Merge Conflicts" count={conflicts.length}>
            {conflicts.map((c) => row(c, "conflict", null))}
          </Section>
        )}
        {staged.length > 0 && (
          <Section
            title="Staged Changes"
            count={staged.length}
            action={
              <GitAction title="Unstage all" disabled={!!busy} onClick={() => props.onUnstage(staged.map((f) => f.path))}>
                <Minus size={13} />
              </GitAction>
            }
          >
            {staged.map((c) =>
              row(
                c,
                "staged",
                <GitAction title="Unstage" disabled={!!busy} onClick={() => props.onUnstage([c.path])}>
                  <Minus size={13} />
                </GitAction>,
              ),
            )}
          </Section>
        )}
        <Section
          title="Changes"
          count={changes.length}
          action={
            changes.length > 0 && (
              <GitAction title="Stage all" disabled={!!busy} onClick={() => props.onStage(changes.map((f) => f.path))}>
                <Plus size={13} />
              </GitAction>
            )
          }
        >
          {changes.length === 0 ? (
            <p className="git-empty small">No changes.</p>
          ) : (
            changes.map((c) =>
              row(
                c,
                "unstaged",
                <GitAction title="Stage" disabled={!!busy} onClick={() => props.onStage([c.path])}>
                  <Plus size={13} />
                </GitAction>,
              ),
            )
          )}
        </Section>
        <History
          enabled={status.hasCommits}
          // A new commit, pull or rebase moves HEAD: read the history again.
          version={`${status.branch}:${status.ahead}:${status.behind}:${status.files.length}:${status.operation}`}
          activeDiff={props.activeDiff}
          onOpenDiff={props.onOpenDiff}
        />
      </div>
    </div>
  );
}

function GitAction(props: { title: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className="git-action"
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}

function Section(props: { title: string; count: number; action?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="git-section">
      <div className="git-section-header" onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={13} className={`chevron ${open ? "open" : ""}`} />
        <span>{props.title}</span>
        {props.count > 0 && <span className="git-count">{props.count}</span>}
        <span className="spacer" />
        {props.action}
      </div>
      {open && props.children}
    </section>
  );
}

function FileRow(props: {
  change: GitFileChange;
  letter: string;
  active: boolean;
  unsaved: boolean;
  onClick: () => void;
  onOpenFile?: () => void;
  action: ReactNode;
}) {
  const { change } = props;
  const folder = dirname(change.path);
  return (
    <div
      className={`git-file ${props.active ? "active" : ""}`}
      onClick={props.onClick}
      title={change.origPath ? `${change.origPath} → ${change.path}` : change.path}
    >
      <FileText size={14} className="icon" />
      <span className={`git-file-name ${props.letter === "D" ? "deleted" : ""}`}>{basename(change.path)}</span>
      {folder !== change.path && folder !== "" && <span className="git-file-folder">{folder}</span>}
      {props.unsaved && (
        <span className="git-unsaved" title="Has unsaved edits: save the file for git to see them">
          ●
        </span>
      )}
      <span className="git-file-actions">
        {props.onOpenFile && (
          <GitAction title="Open file" onClick={props.onOpenFile}>
            <FileText size={13} />
          </GitAction>
        )}
        {props.action}
      </span>
      <span className={`git-letter git-letter-${props.letter === "!" ? "conflict" : props.letter}`}>{props.letter}</span>
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

function History(props: {
  enabled: boolean;
  version: string;
  activeDiff: string | null;
  onOpenDiff: (target: DiffTarget) => void;
}) {
  const [open, setOpen] = useState(true);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [files, setFiles] = useState<GitFileChange[]>([]);

  useEffect(() => {
    if (!open || !props.enabled) return setCommits([]);
    let cancelled = false;
    api.gitLog(HISTORY_SIZE).then(
      (log) => !cancelled && setCommits(log),
      () => !cancelled && setCommits([]),
    );
    return () => {
      cancelled = true;
    };
  }, [open, props.enabled, props.version]);

  const toggle = (commit: GitCommit) => {
    if (expanded === commit.hash) return setExpanded(null);
    setExpanded(commit.hash);
    setFiles([]);
    api.gitCommitFiles(commit.hash).then(setFiles, () => setFiles([]));
  };

  return (
    <section className="git-section">
      <div className="git-section-header" onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={13} className={`chevron ${open ? "open" : ""}`} />
        <span>History</span>
      </div>
      {open && !props.enabled && <p className="git-empty small">No commits yet.</p>}
      {open &&
        commits.map((commit) => (
          <div key={commit.hash}>
            <div
              className={`git-commit ${expanded === commit.hash ? "open" : ""}`}
              onClick={() => toggle(commit)}
              title={`${commit.subject}\n${commit.short} · ${commit.author} <${commit.email}>\n${new Date(commit.date).toLocaleString()}`}
            >
              <GitCommitHorizontal size={14} className="icon" />
              <div className="git-commit-text">
                <span className="git-commit-subject">{commit.subject}</span>
                <span className="git-commit-meta">
                  {commit.author} · {ago(commit.date)} · <code>{commit.short}</code>
                </span>
              </div>
            </div>
            {expanded === commit.hash &&
              files.map((change) => {
                const target: DiffTarget = { kind: "commit", change, commit };
                return (
                  <FileRow
                    key={change.path}
                    change={change}
                    letter={change.staged ?? "M"}
                    active={props.activeDiff === diffKey(target)}
                    unsaved={false}
                    onClick={() => props.onOpenDiff(target)}
                    action={null}
                  />
                );
              })}
          </div>
        ))}
    </section>
  );
}
