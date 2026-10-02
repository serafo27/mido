import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, FileSymlink, Folder, FolderTree, GitBranch, List, Undo2, X } from "lucide-react";
import type { GitFileChange, GitStatus } from "../lib/api";
import { changeTree, itemsIn, type ChangeNode } from "../lib/changeTree";
import { basename, dirname } from "../lib/paths";
import { changeLetter, isDocumentPath } from "../lib/useGit";
import { isMac } from "../lib/platform";
import { useStoredState } from "../lib/useStoredState";
import DiffView from "./DiffView";
import FloatingDialog from "./FloatingDialog";
import { FileIcon, type DiffTarget } from "./SourceControl";

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
  /** Every changed file, rather than only Markdown documents. */
  showAll: boolean;
}

type Check = "on" | "off" | "partial";

/** Staged entirely, partly (some changes still unstaged), or not at all. */
const checkOf = (f: GitFileChange): Check => (f.staged ? (f.unstaged ? "partial" : "on") : "off");

/** The check of several files: on if all are, off if none is. */
function checkOfAll(files: GitFileChange[]): Check {
  const checks = files.map(checkOf);
  if (checks.every((c) => c === "on")) return "on";
  return checks.every((c) => c === "off") ? "off" : "partial";
}

const letterOf = (f: GitFileChange) => (f.staged && !f.unstaged ? (f.staged === "?" ? "A" : f.staged) : changeLetter(f));

/** IntelliJ's commit dialog: tick the files to commit, see their changes, write the message. */
export default function CommitDialog(props: CommitDialogProps) {
  const { status, busy } = props;
  const files = useMemo(
    () => status.files.filter((f) => !f.conflicted && (props.showAll || isDocumentPath(f.path))),
    [status.files, props.showAll],
  );
  const conflicts = status.files.filter((f) => f.conflicted).length;
  const hiddenStaged = status.files.filter((f) => !f.conflicted && f.staged && !props.showAll && !isDocumentPath(f.path)).length;
  const [selected, setSelected] = useState<string | null>(files[0]?.path ?? null);
  const [view, setView] = useStoredState<"tree" | "list">("mido.commitDialog.view", "tree");
  const [listWidth, setListWidth] = useStoredState("mido.commitDialog.listWidth", 340);
  // Folders are open unless closed, so new ones show their files.
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const message = useRef<HTMLTextAreaElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const checked = files.filter((f) => f.staged);
  const canCommit = !busy && checked.length + hiddenStaged > 0 && props.message.trim() !== "" && conflicts === 0;
  const tree = useMemo(() => changeTree(files, (f) => f.path), [files]);

  useEffect(() => {
    message.current?.focus();
  }, []);
  // Keep a file selected while the list changes (a discarded file disappears).
  useEffect(() => {
    if (!files.some((f) => f.path === selected)) setSelected(files[0]?.path ?? null);
  }, [files, selected]);

  /** Stages the files, or unstages them if they're all staged already. */
  const toggle = (list: GitFileChange[]) =>
    checkOfAll(list) === "on" ? props.onUnstage(list.map((f) => f.path)) : props.onStage(list.filter((f) => checkOf(f) !== "on").map((f) => f.path));

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

  const resizeList = (e: ReactPointerEvent) => {
    e.preventDefault();
    const box = main.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => setListWidth(Math.round(Math.min(Math.max(ev.clientX - box.left, 200), box.width - 260)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const folders = useMemo(() => {
    const all: string[] = [];
    const walk = (nodes: ChangeNode<GitFileChange>[]) =>
      nodes.forEach((n) => n.kind === "folder" && (all.push(n.path), walk(n.children)));
    walk(tree);
    return all;
  }, [tree]);

  const fileRow = (f: GitFileChange, depth: number, showFolder: boolean) => {
    const letter = letterOf(f);
    return (
      <div
        key={f.path}
        className={`commit-file tone-${letter} ${f.path === selected ? "selected" : ""}`}
        style={{ paddingLeft: 12 + depth * 16 + (view === "tree" ? 16 : 0) }}
        onClick={() => setSelected(f.path)}
        onDoubleClick={() => props.onOpenDiff({ kind: f.unstaged ? "unstaged" : "staged", change: f }, true)}
        title={f.path}
      >
        <Checkbox state={checkOf(f)} onChange={() => toggle([f])} disabled={!!busy} />
        <FileIcon path={f.path} />
        <span className="scm-file-name">{basename(f.path)}</span>
        {showFolder && dirname(f.path) !== f.path && <span className="scm-file-folder">{dirname(f.path)}</span>}
        <span className="commit-file-end">
          {f.local && letter !== "D" && (
            <button
              className="scm-action commit-file-discard"
              title="Open File"
              aria-label="Open File"
              onClick={(e) => {
                e.stopPropagation();
                props.onOpenFile(f.local!);
              }}
            >
              <FileSymlink size={13} />
            </button>
          )}
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
        </span>
      </div>
    );
  };

  const renderTree = (nodes: ChangeNode<GitFileChange>[], depth: number): React.ReactNode[] =>
    nodes.map((node) => {
      if (node.kind === "file") return fileRow(node.item, depth, false);
      const open = !closed.has(node.path);
      const inside = itemsIn(node);
      return (
        <div key={`dir:${node.path}`} role="group">
          <div
            className="commit-folder"
            style={{ paddingLeft: 12 + depth * 16 }}
            onClick={() =>
              setClosed((c) => {
                const next = new Set(c);
                if (open) next.add(node.path);
                else next.delete(node.path);
                return next;
              })
            }
            title={node.path}
          >
            <ChevronRight size={14} className={`chevron ${open ? "open" : ""}`} />
            <Checkbox state={checkOfAll(inside)} onChange={() => toggle(inside)} disabled={!!busy} />
            <Folder size={14} className="commit-folder-icon" />
            <span className="commit-folder-name">{node.name}</span>
            <span className="commit-folder-count">{inside.length}</span>
          </div>
          {open && renderTree(node.children, depth + 1)}
        </div>
      );
    });

  const current = files.find((f) => f.path === selected) ?? null;
  const target: DiffTarget | null = current && { kind: "working", change: current };

  return (
    <FloatingDialog
      storageKey="mido.commitDialog.bounds"
      size={{ width: 1180, height: 760 }}
      minSize={{ width: 640, height: 420 }}
      className="commit-dialog"
      label="Commit Changes"
      onKeyDown={onKey}
      header={
        <>
          <span className="git-dialog-title">Commit Changes</span>
          <span className="git-dialog-branch">
            <GitBranch size={13} />
            {status.branch ?? "detached HEAD"}
          </span>
          <span className="spacer" />
          <button className="icon-button" onClick={props.onClose} title="Close (Esc)" aria-label="Close">
            <X size={15} />
          </button>
        </>
      }
    >
      <div className="commit-dialog-main" ref={main} style={{ gridTemplateColumns: `${listWidth}px 1px 1fr` }}>
        <div className="commit-files">
          <div className="commit-files-header">
            <Checkbox state={checkOfAll(files)} onChange={() => toggle(files)} disabled={!!busy || files.length === 0} />
            <span>Changes</span>
            <span className="commit-files-count">
              {checked.length} of {files.length}
            </span>
            <span className="commit-files-tools">
              {view === "tree" && folders.length > 0 && (
                <button
                  className="scm-action"
                  title={closed.size ? "Expand All" : "Collapse All"}
                  aria-label={closed.size ? "Expand All" : "Collapse All"}
                  onClick={() => setClosed(closed.size ? new Set() : new Set(folders))}
                >
                  {closed.size ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
                </button>
              )}
              <button
                className="scm-action"
                title={view === "tree" ? "View as List" : "View as Tree"}
                aria-label={view === "tree" ? "View as List" : "View as Tree"}
                onClick={() => setView(view === "tree" ? "list" : "tree")}
              >
                {view === "tree" ? <List size={14} /> : <FolderTree size={14} />}
              </button>
            </span>
          </div>
          <div className="commit-files-list">
            {files.length === 0 && <p className="scm-empty small">Nothing to commit.</p>}
            {view === "tree" ? renderTree(tree, 0) : files.map((f) => fileRow(f, 0, true))}
          </div>
        </div>
        <div className="commit-split" onPointerDown={resizeList} />
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
          {hiddenStaged > 0 && (
            <span className="git-dialog-hint">
              {hiddenStaged === 1 ? "1 staged file that isn't Markdown" : `${hiddenStaged} staged files that aren't Markdown`} will be
              committed too.
            </span>
          )}
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
    </FloatingDialog>
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
