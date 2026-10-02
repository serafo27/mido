import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileSymlink,
  Folder,
  FolderTree,
  GitBranch,
  List,
  Undo2,
} from "lucide-react";
import { api, type CommitOptions, type GitFileChange, type GitStatus } from "../lib/api";
import type { Author } from "../lib/comments";
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
  /** Who git commits as, shown as the author's placeholder. */
  identity: Author | null;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
  /** Resolves to true once committed; `push` then opens the push dialog. */
  onCommit: (push: boolean, options: CommitOptions) => Promise<boolean>;
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
  if (checks.length && checks.every((c) => c === "on")) return "on";
  return checks.every((c) => c === "off") ? "off" : "partial";
}

const letterOf = (f: GitFileChange) => (f.staged && !f.unstaged ? (f.staged === "?" ? "A" : f.staged) : changeLetter(f));

/** New files git doesn't know yet: IntelliJ lists them apart. */
const isUnversioned = (f: GitFileChange) => f.unstaged === "?" && !f.staged;

const filesLabel = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;

/** IntelliJ's commit dialog: the files to commit and the message on top, git's options beside them, the diff below. */
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
  // The top part's height (files and message) and the Git options' width, as in IntelliJ.
  const [topHeight, setTopHeight] = useStoredState("mido.commitDialog.topHeight", 330);
  const [diffOpen, setDiffOpen] = useStoredState("mido.commitDialog.diffOpen", true);
  // Folders and groups are open unless closed, so new ones show their files.
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [amend, setAmend] = useState(false);
  const [signOff, setSignOff] = useStoredState("mido.commitDialog.signOff", false);
  const [author, setAuthor] = useState("");
  const message = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const checked = files.filter((f) => f.staged);
  const canCommit =
    !busy && (checked.length + hiddenStaged > 0 || amend) && props.message.trim() !== "" && conflicts === 0;

  const groups = useMemo(() => {
    const tracked = files.filter((f) => !isUnversioned(f));
    const unversioned = files.filter(isUnversioned);
    return [
      { key: "group:changes", name: "Changes", files: tracked },
      { key: "group:unversioned", name: "Unversioned Files", files: unversioned },
    ].filter((g) => g.files.length > 0);
  }, [files]);
  // The files in the order they're shown, for the diff's previous and next file.
  const ordered = useMemo(() => {
    if (view === "list") return groups.flatMap((g) => g.files);
    const out: GitFileChange[] = [];
    const walk = (nodes: ChangeNode<GitFileChange>[]) =>
      nodes.forEach((n) => (n.kind === "file" ? out.push(n.item) : walk(n.children)));
    groups.forEach((g) => walk(changeTree(g.files, (f) => f.path)));
    return out;
  }, [groups, view]);

  useEffect(() => {
    message.current?.focus();
  }, []);
  // Keep a file selected while the list changes (a discarded file disappears).
  useEffect(() => {
    if (!files.some((f) => f.path === selected)) setSelected(ordered[0]?.path ?? null);
  }, [files, ordered, selected]);

  /** Stages the files, or unstages them if they're all staged already. */
  const toggle = (list: GitFileChange[]) =>
    checkOfAll(list) === "on"
      ? props.onUnstage(list.map((f) => f.path))
      : props.onStage(list.filter((f) => checkOf(f) !== "on").map((f) => f.path));

  /** Amending starts from the last commit's message, as IntelliJ does. */
  const changeAmend = async (next: boolean) => {
    setAmend(next);
    if (next && !props.message.trim()) {
      try {
        props.onMessageChange(await api.gitLastMessage());
      } catch {
        // No last message to start from: the box stays empty.
      }
    }
  };

  const commit = async (push: boolean) => {
    if (canCommit && (await props.onCommit(push, { amend, signOff, author: author.trim() }))) props.onClose();
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

  const resizeTop = (e: ReactPointerEvent) => {
    e.preventDefault();
    const box = body.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) =>
      setTopHeight(Math.round(Math.min(Math.max(ev.clientY - box.top, 180), box.height - 140)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const folders = useMemo(() => {
    const all: string[] = groups.map((g) => g.key);
    const walk = (nodes: ChangeNode<GitFileChange>[]) =>
      nodes.forEach((n) => n.kind === "folder" && (all.push(n.path), walk(n.children)));
    groups.forEach((g) => walk(changeTree(g.files, (f) => f.path)));
    return all;
  }, [groups]);

  const toggleOpen = (key: string, open: boolean) =>
    setClosed((c) => {
      const next = new Set(c);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });

  const indent = (depth: number) => ({ paddingLeft: 8 + depth * 18 });

  const fileRow = (f: GitFileChange, depth: number, showFolder: boolean) => {
    const letter = letterOf(f);
    return (
      <div
        key={f.path}
        className={`commit-file tone-${letter} ${f.path === selected ? "selected" : ""}`}
        style={indent(depth + 1)}
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
              className="scm-action commit-file-action"
              title="Open File"
              aria-label="Open File"
              onClick={(e) => {
                e.stopPropagation();
                props.onOpenFile(f.local!);
                props.onClose();
              }}
            >
              <FileSymlink size={13} />
            </button>
          )}
          {f.unstaged && (
            <button
              className="scm-action commit-file-action"
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

  /** A group or a folder: its files can be ticked together. */
  const folderRow = (key: string, name: string, inside: GitFileChange[], depth: number, group: boolean) => {
    const open = !closed.has(key);
    return (
      <div
        className={`commit-folder ${group ? "group" : ""}`}
        style={indent(depth)}
        onClick={() => toggleOpen(key, open)}
        title={group ? undefined : key}
      >
        <ChevronRight size={13} className={`chevron ${open ? "open" : ""}`} />
        <Checkbox state={checkOfAll(inside)} onChange={() => toggle(inside)} disabled={!!busy} />
        {!group && <Folder size={14} className="commit-folder-icon" />}
        <span className="commit-folder-name">{name}</span>
        <span className="commit-folder-count">{filesLabel(inside.length)}</span>
      </div>
    );
  };

  const renderTree = (nodes: ChangeNode<GitFileChange>[], depth: number): React.ReactNode[] =>
    nodes.map((node) => {
      if (node.kind === "file") return fileRow(node.item, depth, false);
      return (
        <div key={`dir:${node.path}`} role="group">
          {folderRow(node.path, node.name, itemsIn(node), depth, false)}
          {!closed.has(node.path) && renderTree(node.children, depth + 1)}
        </div>
      );
    });

  const current = files.find((f) => f.path === selected) ?? null;
  const target: DiffTarget | null = current && { kind: "working", change: current };
  const index = current ? ordered.indexOf(current) : -1;
  const step = (by: number) => {
    const next = ordered[index + by];
    if (next) setSelected(next.path);
  };

  return (
    <FloatingDialog
      storageKey="mido.commitDialog.bounds"
      size={{ width: 1180, height: 820 }}
      minSize={{ width: 720, height: 520 }}
      className="commit-dialog"
      label="Commit Changes"
      onKeyDown={onKey}
      onClose={props.onClose}
      header={
        <>
          <span className="git-dialog-title">Commit Changes</span>
          <span className="git-dialog-branch">
            <GitBranch size={13} />
            {status.branch ?? "detached HEAD"}
          </span>
        </>
      }
    >
      <div className="commit-dialog-body" ref={body}>
        <div className="commit-top" style={diffOpen ? { height: topHeight } : { flex: 1 }}>
          <div className="commit-left">
            <div className="commit-toolbar">
              <button
                className="scm-action"
                title="Discard Changes in the Selected File"
                aria-label="Discard Changes"
                disabled={!!busy || !current?.unstaged}
                onClick={() => current && props.onDiscard([current.path])}
              >
                <Undo2 size={14} />
              </button>
              <span className="commit-toolbar-sep" />
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
              <span className="spacer" />
              <span className="commit-files-count">
                {checked.length} of {filesLabel(files.length)} selected
              </span>
            </div>
            <div className="commit-files-list">
              {files.length === 0 && <p className="scm-empty small">Nothing to commit.</p>}
              {groups.map((g) => (
                <div key={g.key} role="group">
                  {folderRow(g.key, g.name, g.files, 0, true)}
                  {!closed.has(g.key) &&
                    (view === "tree"
                      ? renderTree(changeTree(g.files, (f) => f.path), 1)
                      : g.files.map((f) => fileRow(f, 0, true)))}
                </div>
              ))}
            </div>
            <div className="commit-section-title">
              <span>Commit Message</span>
            </div>
            <textarea
              ref={message}
              className="commit-message"
              value={props.message}
              onChange={(e) => props.onMessageChange(e.target.value)}
              placeholder={amend ? "Message of the amended commit" : "Commit message"}
              spellCheck
            />
          </div>

          <aside className="commit-options">
            <div className="commit-section-title">
              <span>Git</span>
            </div>
            <label className="commit-option-field">
              <span>Author</span>
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder={props.identity ? `${props.identity.name}${props.identity.email ? ` <${props.identity.email}>` : ""}` : "Name <email>"}
                spellCheck={false}
              />
            </label>
            <label className="commit-option">
              <Checkbox state={amend ? "on" : "off"} onChange={() => changeAmend(!amend)} />
              <span>Amend commit</span>
            </label>
            <label className="commit-option">
              <Checkbox state={signOff ? "on" : "off"} onChange={() => setSignOff(!signOff)} />
              <span>Sign-off commit</span>
            </label>
            {amend && <p className="commit-option-note">Replaces the last commit, with the changes ticked here added to it.</p>}
          </aside>
        </div>

        <div className={`commit-diff ${diffOpen ? "" : "closed"}`}>
          <div className="commit-diff-title" onPointerDown={diffOpen ? resizeTop : undefined}>
            <button
              className="commit-diff-toggle"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setDiffOpen(!diffOpen)}
              aria-expanded={diffOpen}
            >
              <ChevronRight size={13} className={`chevron ${diffOpen ? "open" : ""}`} />
              Diff
            </button>
            <span className="commit-section-rule" />
            {diffOpen && ordered.length > 0 && (
              <span className="commit-diff-files" onPointerDown={(e) => e.stopPropagation()}>
                <button className="scm-action" title="Previous File" aria-label="Previous File" disabled={index <= 0} onClick={() => step(-1)}>
                  <ArrowLeft size={13} />
                </button>
                <span>
                  {index + 1}/{filesLabel(ordered.length)}
                </span>
                <button
                  className="scm-action"
                  title="Next File"
                  aria-label="Next File"
                  disabled={index >= ordered.length - 1}
                  onClick={() => step(1)}
                >
                  <ArrowRight size={13} />
                </button>
              </span>
            )}
          </div>
          {diffOpen && (
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
          )}
        </div>
      </div>

      <footer className="commit-dialog-footer">
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
          {amend ? "Amend and Push…" : "Commit and Push…"}
        </button>
        <button className="primary-button small" disabled={!canCommit} onClick={() => commit(false)} title={isMac ? "⌘↵" : "Ctrl+Enter"}>
          {amend ? "Amend Commit" : "Commit"}
        </button>
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
