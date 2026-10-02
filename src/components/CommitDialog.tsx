import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { GitBranch, Undo2, X } from "lucide-react";
import type { GitFileChange, GitStatus } from "../lib/api";
import { basename, dirname } from "../lib/paths";
import { changeLetter } from "../lib/useGit";
import { isMac } from "../lib/platform";
import DiffView from "./DiffView";
import type { DiffTarget } from "./SourceControl";

interface CommitDialogProps {
  status: GitStatus;
  busy: string | null;
  /** Changes when the repository does, so the preview reloads. */
  version: string;
  /** Shared with the panel's message box. */
  message: string;
  onMessageChange: (message: string) => void;
  /** Local paths of files with edits not saved yet. */
  unsaved: Set<string>;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
  /** Resolves to true once committed; `push` then opens the push dialog. */
  onCommit: (push: boolean) => Promise<boolean>;
  onOpenDiff: (target: DiffTarget, pin?: boolean) => void;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

type Check = "on" | "off" | "partial";

/** Staged entirely, partly (some changes still unstaged), or not at all. */
const checkOf = (f: GitFileChange): Check => (f.staged ? (f.unstaged ? "partial" : "on") : "off");

/** IntelliJ's commit dialog: tick the files to commit, see their changes, write the message. */
export default function CommitDialog(props: CommitDialogProps) {
  const { status, busy } = props;
  const files = useMemo(() => status.files.filter((f) => !f.conflicted), [status.files]);
  const conflicts = status.files.length - files.length;
  const [selected, setSelected] = useState<string | null>(files[0]?.path ?? null);
  const message = useRef<HTMLTextAreaElement>(null);
  const checked = files.filter((f) => f.staged);
  const canCommit = !busy && checked.length > 0 && props.message.trim() !== "" && conflicts === 0;

  useEffect(() => {
    message.current?.focus();
  }, []);
  // Keep a file selected while the list changes (a discarded file disappears).
  useEffect(() => {
    if (!files.some((f) => f.path === selected)) setSelected(files[0]?.path ?? null);
  }, [files, selected]);

  const toggle = (f: GitFileChange) => (checkOf(f) === "on" ? props.onUnstage([f.path]) : props.onStage([f.path]));
  const all: Check = checked.length === 0 ? "off" : checked.length === files.length && files.every((f) => !f.unstaged) ? "on" : "partial";
  const toggleAll = () =>
    all === "on" ? props.onUnstage(files.map((f) => f.path)) : props.onStage(files.filter((f) => checkOf(f) !== "on").map((f) => f.path));

  const commit = async (push: boolean) => {
    if (canCommit && (await props.onCommit(push))) props.onClose();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.key === "Enter" && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      commit(e.altKey);
    }
  };

  const current = files.find((f) => f.path === selected) ?? null;
  const target: DiffTarget | null = current && { kind: "working", change: current };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="git-dialog commit-dialog" role="dialog" aria-label="Commit Changes" onKeyDown={onKey}>
        <header className="git-dialog-header">
          <span className="git-dialog-title">Commit Changes</span>
          <span className="git-dialog-branch">
            <GitBranch size={13} />
            {status.branch ?? "detached HEAD"}
          </span>
          <span className="spacer" />
          <button className="icon-button" onClick={props.onClose} title="Close (Esc)" aria-label="Close">
            <X size={15} />
          </button>
        </header>

        <div className="commit-dialog-main">
          <div className="commit-files">
            <label className="commit-files-header">
              <Checkbox state={all} onChange={toggleAll} disabled={!!busy || files.length === 0} />
              <span>Changes</span>
              <span className="commit-files-count">
                {checked.length} of {files.length} selected
              </span>
            </label>
            <div className="commit-files-list">
              {files.length === 0 && <p className="scm-empty small">Nothing to commit.</p>}
              {files.map((f) => {
                const letter = f.staged && !f.unstaged ? (f.staged === "?" ? "A" : f.staged) : changeLetter(f);
                return (
                  <div
                    key={f.path}
                    className={`commit-file tone-${letter} ${f.path === selected ? "selected" : ""}`}
                    onClick={() => setSelected(f.path)}
                    onDoubleClick={() => props.onOpenDiff({ kind: f.unstaged ? "unstaged" : "staged", change: f }, true)}
                    title={f.path}
                  >
                    <Checkbox state={checkOf(f)} onChange={() => toggle(f)} disabled={!!busy} />
                    <span className="scm-file-name">{basename(f.path)}</span>
                    {dirname(f.path) !== f.path && <span className="scm-file-folder">{dirname(f.path)}</span>}
                    {f.unstaged && (
                      <button
                        className="scm-action commit-file-discard"
                        title="Discard Changes"
                        aria-label="Discard Changes"
                        disabled={!!busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onDiscard([f.path]);
                        }}
                      >
                        <Undo2 size={13} />
                      </button>
                    )}
                    {f.local && props.unsaved.has(f.local) && <span className="scm-unsaved" title="Unsaved edits" />}
                    <span className="scm-letter">{letter}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="commit-preview">
            {target ? (
              <DiffView
                key={target.change.path}
                target={target}
                version={props.version}
                busy={!!busy}
                embedded
                onOpenFile={(path) => {
                  props.onOpenFile(path);
                  props.onClose();
                }}
                onStage={props.onStage}
                onUnstage={props.onUnstage}
                onResolve={async () => false}
              />
            ) : (
              <p className="diff-message">Select a file to see its changes.</p>
            )}
          </div>
        </div>

        <footer className="commit-dialog-footer">
          <textarea
            ref={message}
            value={props.message}
            onChange={(e) => props.onMessageChange(e.target.value)}
            placeholder="Commit message"
            rows={4}
            spellCheck
          />
          <div className="git-dialog-buttons">
            {conflicts > 0 && <span className="git-dialog-hint">Resolve the merge conflicts first.</span>}
            {busy && <span className="git-dialog-hint">{busy}</span>}
            <span className="spacer" />
            <button className="ghost-button" onClick={props.onClose}>
              Cancel
            </button>
            <button
              className="ghost-button"
              disabled={!canCommit || status.remotes.length === 0}
              onClick={() => commit(true)}
              title={`Commit, then review the push (${isMac ? "⌥⌘↵" : "Ctrl+Alt+Enter"})`}
            >
              Commit and Push…
            </button>
            <button className="primary-button small" disabled={!canCommit} onClick={() => commit(false)} title={isMac ? "⌘↵" : "Ctrl+Enter"}>
              Commit
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Checkbox(props: { state: Check; disabled?: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = props.state === "partial";
  }, [props.state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="git-checkbox"
      checked={props.state === "on"}
      disabled={props.disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={props.onChange}
    />
  );
}
