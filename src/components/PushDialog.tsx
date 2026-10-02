import { useEffect, useState, type KeyboardEvent } from "react";
import { ArrowRight, GitBranch, GitCommitHorizontal } from "lucide-react";
import { api, type GitCommit, type GitFileChange, type GitStatus } from "../lib/api";
import { basename, dirname } from "../lib/paths";
import { isMac } from "../lib/platform";
import FloatingDialog from "./FloatingDialog";
import type { DiffTarget } from "./SourceControl";

interface PushDialogProps {
  status: GitStatus;
  busy: string | null;
  /** `remote` publishes the branch there; null pushes to its upstream. Resolves to whether it worked. */
  onPush: (remote: string | null) => Promise<boolean>;
  onOpenDiff: (target: DiffTarget, pin?: boolean) => void;
  onClose: () => void;
}

/** IntelliJ's push dialog: the commits about to leave, and where they go. */
export default function PushDialog(props: PushDialogProps) {
  const { status, busy } = props;
  const [commits, setCommits] = useState<GitCommit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GitCommit | null>(null);
  const [files, setFiles] = useState<GitFileChange[]>([]);
  const [remote, setRemote] = useState(status.remotes.includes("origin") ? "origin" : (status.remotes[0] ?? ""));
  const publishing = !status.upstream;

  useEffect(() => {
    api.gitOutgoing().then(
      (list) => {
        setCommits(list);
        setSelected(list[0] ?? null);
      },
      (e) => setError(String(e)),
    );
  }, []);

  useEffect(() => {
    setFiles([]);
    if (selected) api.gitCommitFiles(selected.hash).then(setFiles, () => setFiles([]));
  }, [selected]);

  const canPush = !busy && status.branch !== null && status.remotes.length > 0 && (publishing || (commits?.length ?? 0) > 0);
  const push = async () => {
    if (canPush && (await props.onPush(publishing ? remote : null))) props.onClose();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.key === "Enter" && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      push();
    }
  };

  return (
    <FloatingDialog
      storageKey="mido.pushDialog.bounds"
      size={{ width: 900, height: 560 }}
      minSize={{ width: 560, height: 340 }}
      className="push-dialog"
      label="Push Commits"
      onKeyDown={onKey}
      onClose={props.onClose}
      header={
        <>
          <span className="git-dialog-title">Push Commits</span>
        </>
      }
    >

        <div className="push-target">
          <GitBranch size={14} />
          <strong>{status.branch ?? "detached HEAD"}</strong>
          <ArrowRight size={14} />
          {publishing ? (
            <>
              {status.remotes.length > 1 ? (
                <select value={remote} onChange={(e) => setRemote(e.target.value)}>
                  {status.remotes.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              ) : (
                <strong>{remote || "no remote"}</strong>
              )}
              <span className="push-new">/{status.branch}</span>
              <span className="push-badge">New</span>
            </>
          ) : (
            <strong>{status.upstream}</strong>
          )}
        </div>

        <div className="push-main">
          <div className="push-commits">
            {error && <p className="scm-empty small">{error}</p>}
            {commits === null && !error && <p className="scm-empty small">Loading…</p>}
            {commits?.length === 0 && (
              <p className="scm-empty small">
                {publishing ? "No new commits: the branch will be published as it is." : "Nothing to push: every commit is on the remote."}
              </p>
            )}
            {commits?.map((commit) => (
              <div
                key={commit.hash}
                className={`push-commit ${selected?.hash === commit.hash ? "selected" : ""}`}
                onClick={() => setSelected(commit)}
                title={`${commit.subject}\n${commit.author} · ${new Date(commit.date).toLocaleString()}`}
              >
                <GitCommitHorizontal size={14} className="icon" />
                <span className="push-commit-subject">{commit.subject}</span>
                <span className="push-commit-meta">
                  {commit.author} · <code>{commit.short}</code>
                </span>
              </div>
            ))}
          </div>
          <div className="push-files">
            {selected && <div className="push-files-title">{selected.subject}</div>}
            {files.map((change) => (
              <div
                key={change.path}
                className={`commit-file tone-${change.staged ?? "M"}`}
                onClick={() => {
                  props.onOpenDiff({ kind: "commit", change, commit: selected! }, true);
                  props.onClose();
                }}
                title="Open the diff in a tab"
              >
                <span className="scm-file-name">{basename(change.path)}</span>
                {dirname(change.path) !== change.path && <span className="scm-file-folder">{dirname(change.path)}</span>}
                <span className="scm-letter">{change.staged ?? "M"}</span>
              </div>
            ))}
          </div>
        </div>

        <footer className="git-dialog-buttons padded">
          {busy && <span className="git-dialog-hint">{busy}</span>}
          <span className="spacer" />
          <button className="ghost-button" onClick={props.onClose}>
            Cancel
          </button>
          <button className="primary-button small" disabled={!canPush} onClick={push} title={isMac ? "⌘↵" : "Ctrl+Enter"}>
            {publishing ? "Publish and Push" : "Push"}
          </button>
        </footer>
    </FloatingDialog>
  );
}
