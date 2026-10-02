import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronRight, Columns2, FileSymlink, Minus, Plus, Rows2 } from "lucide-react";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorSelection, EditorState, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, lineNumbers, type DecorationSet } from "@codemirror/view";
import { MergeView, goToNextChunk, goToPreviousChunk, unifiedMergeView } from "@codemirror/merge";
import { api, type FileVersions } from "../lib/api";
import { findConflicts, resolution, resolveAll, type Conflict, type Resolution } from "../lib/conflicts";
import { useStoredState } from "../lib/useStoredState";
import { markdownHighlight } from "./Editor";
import type { DiffTarget } from "./SourceControl";

interface DiffViewProps {
  target: DiffTarget;
  /** Changes when the repository does, to load both versions again. */
  version: string;
  busy: boolean;
  /** Inside the commit dialog: no stage buttons, the dialog's checkboxes do that. */
  embedded?: boolean;
  onOpenFile: (path: string) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  /** Writes the resolved file and stages it; resolves to whether it worked. */
  onResolve: (path: string, content: string) => Promise<boolean>;
}

/* ---------- the editors: compact and monospaced, like VS Code's diff editor ---------- */

const diffEditorTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", color: "var(--text)", backgroundColor: "var(--bg-editor)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--md-font-code)", lineHeight: "20px" },
  ".cm-content": { padding: "6px 0 40px", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0 18px 0 6px" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-gutters": { backgroundColor: "var(--bg-editor)", border: "none", color: "var(--text-faint)" },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "38px",
    padding: "0 10px 0 12px",
    fontSize: "12px",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-muted)" },
});

// The editor's Markdown colours, with headings the size of the other lines: in a diff every
// line is one row, as in VS Code.
const diffHighlight = HighlightStyle.define(markdownHighlight.specs.map(({ fontSize: _size, ...spec }) => spec));

const editorExtensions = (editable: boolean, highlight: boolean): Extension[] => [
  lineNumbers(),
  highlight
    ? [
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(diffHighlight),
      ]
    : [],
  diffEditorTheme,
  EditorView.lineWrapping,
  EditorView.editable.of(editable),
  EditorState.readOnly.of(!editable),
];

/** What each side of a diff is, in git's terms. */
function sides(target: DiffTarget, versions: FileVersions): [string, string] {
  const left =
    target.kind === "commit" ? `${target.commit.short}^` : target.kind === "staged" || target.kind === "working" ? "HEAD" : "Index";
  const right = target.kind === "commit" ? target.commit.short : target.kind === "staged" ? "Index" : "Working Tree";
  return [versions.original === null ? `${left} (none)` : left, versions.modified === null ? `${right} (deleted)` : right];
}

export default function DiffView(props: DiffViewProps) {
  const { target } = props;
  const { change } = target;
  const [versions, setVersions] = useState<FileVersions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useStoredState<"split" | "unified">("mido.diffLayout", "split");
  // The editor the change navigation moves through (the right one, side by side).
  const navigator = useRef<EditorView | null>(null);
  const conflictEditor = useRef<EditorView | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    // A conflict shows the working file, markers and all.
    const kind = target.kind === "conflict" ? "unstaged" : target.kind;
    const commit = target.kind === "commit" ? target.commit.hash : null;
    api.gitFileVersions(kind, change.path, change.origPath, commit).then(
      (v) => !cancelled && setVersions(v),
      (e) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
    // `version`: the file may have changed on disk or in the index.
  }, [target, props.version]);

  const goToChange = (direction: 1 | -1) => {
    const view = navigator.current;
    if (!view) return;
    (direction === 1 ? goToNextChunk : goToPreviousChunk)(view);
    view.focus();
  };
  const goToConflict = (direction: 1 | -1) => {
    const view = conflictEditor.current;
    if (!view) return;
    const conflicts = findConflicts(view.state.doc.toString());
    const at = view.state.selection.main.head;
    const next =
      direction === 1
        ? (conflicts.find((c) => c.from > at) ?? conflicts[0])
        : ([...conflicts].reverse().find((c) => c.from < at) ?? conflicts.at(-1));
    if (!next) return;
    view.dispatch({
      selection: EditorSelection.cursor(next.from),
      effects: EditorView.scrollIntoView(next.from, { y: "center" }),
    });
    view.focus();
  };

  const crumbs = change.path.split("/");
  const isConflict = target.kind === "conflict";
  const comparing = versions !== null && !versions.binary && !isConflict;

  return (
    <div className="diff-view">
      <header className="diff-header">
        <div className="diff-crumbs" title={change.origPath ? `${change.origPath} → ${change.path}` : change.path}>
          {crumbs.map((part, i) => (
            <span key={i} className={i === crumbs.length - 1 ? "crumb current" : "crumb"}>
              {i > 0 && <ChevronRight size={12} className="crumb-sep" />}
              {part}
            </span>
          ))}
          {comparing && (
            <span className="diff-sides-label">
              {sides(target, versions)[0]} ↔ {sides(target, versions)[1]}
            </span>
          )}
        </div>
        <div className="diff-actions">
          {comparing && (
            <>
              <DiffAction title="Previous change" onClick={() => goToChange(-1)}>
                <ArrowUp size={15} />
              </DiffAction>
              <DiffAction title="Next change" onClick={() => goToChange(1)}>
                <ArrowDown size={15} />
              </DiffAction>
              <DiffAction
                title={layout === "split" ? "Show inline" : "Show side by side"}
                onClick={() => setLayout(layout === "split" ? "unified" : "split")}
              >
                {layout === "split" ? <Rows2 size={15} /> : <Columns2 size={15} />}
              </DiffAction>
            </>
          )}
          {isConflict && (
            <>
              <DiffAction title="Previous conflict" onClick={() => goToConflict(-1)}>
                <ArrowUp size={15} />
              </DiffAction>
              <DiffAction title="Next conflict" onClick={() => goToConflict(1)}>
                <ArrowDown size={15} />
              </DiffAction>
            </>
          )}
          {target.kind === "unstaged" && !props.embedded && (
            <DiffAction title="Stage changes" disabled={props.busy} onClick={() => props.onStage([change.path])}>
              <Plus size={15} />
            </DiffAction>
          )}
          {target.kind === "staged" && !props.embedded && (
            <DiffAction title="Unstage changes" disabled={props.busy} onClick={() => props.onUnstage([change.path])}>
              <Minus size={15} />
            </DiffAction>
          )}
          {change.local && target.kind !== "commit" && versions?.modified !== null && (
            <DiffAction title="Open file" onClick={() => props.onOpenFile(change.local!)}>
              <FileSymlink size={15} />
            </DiffAction>
          )}
        </div>
      </header>
      {error ? (
        <p className="diff-message">{error}</p>
      ) : !versions ? null : versions.binary ? (
        <p className="diff-message">This file isn't text, or it's too big to compare.</p>
      ) : isConflict ? (
        <ConflictEditor
          key={`${change.path}:${props.version}`}
          path={change.path}
          text={versions.modified ?? ""}
          busy={props.busy}
          viewRef={conflictEditor}
          onResolve={props.onResolve}
        />
      ) : (
        <Comparison
          original={versions.original ?? ""}
          modified={versions.modified ?? ""}
          layout={layout}
          navigator={navigator}
        />
      )}
    </div>
  );
}

function DiffAction(props: { title: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className="diff-action"
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** Two versions, read-only: side by side, or one with the other's lines shown inline. */
function Comparison(props: {
  original: string;
  modified: string;
  layout: "split" | "unified";
  navigator: { current: EditorView | null };
}) {
  const host = useRef<HTMLDivElement>(null);
  const identical = props.original === props.modified;

  useEffect(() => {
    const parent = host.current;
    if (!parent || identical) return;
    const collapseUnchanged = { margin: 3, minSize: 8 };
    let view: EditorView;
    let destroy: () => void;
    if (props.layout === "split") {
      const merge = new MergeView({
        a: { doc: props.original, extensions: editorExtensions(false, true) },
        b: { doc: props.modified, extensions: editorExtensions(false, true) },
        parent,
        gutter: true,
        collapseUnchanged,
      });
      view = merge.b;
      destroy = () => merge.destroy();
    } else {
      view = new EditorView({
        parent,
        state: EditorState.create({
          doc: props.modified,
          extensions: [
            editorExtensions(false, true),
            unifiedMergeView({ original: props.original, mergeControls: false, gutter: true, collapseUnchanged }),
          ],
        }),
      });
      destroy = () => view.destroy();
    }
    props.navigator.current = view;
    // Start on the first change, as VS Code does.
    const frame = requestAnimationFrame(() => goToNextChunk(view));
    return () => {
      cancelAnimationFrame(frame);
      props.navigator.current = null;
      destroy();
    };
  }, [props.original, props.modified, props.layout, identical]);

  if (identical) return <p className="diff-message">No changes.</p>;
  return <div className={`diff-body ${props.layout}`} ref={host} />;
}

/* ---------- conflicts, shown as VS Code shows them in the editor ---------- */

/** "Accept Current Change | Accept Incoming Change | Accept Both Changes" above a conflict. */
class ConflictLens extends WidgetType {
  constructor(
    readonly conflict: Conflict,
    readonly index: number,
  ) {
    super();
  }

  eq(other: ConflictLens) {
    return other.index === this.index && other.conflict.from === this.conflict.from && other.conflict.to === this.conflict.to;
  }

  toDOM(view: EditorView) {
    const lens = document.createElement("div");
    lens.className = "conflict-lens";
    const choices: [Resolution, string][] = [
      ["ours", "Accept Current Change"],
      ["theirs", "Accept Incoming Change"],
      ["both", "Accept Both Changes"],
    ];
    choices.forEach(([choice, label], i) => {
      if (i > 0) lens.append(document.createTextNode(" | "));
      const link = document.createElement("button");
      link.textContent = label;
      link.onmousedown = (e) => e.preventDefault();
      link.onclick = () => {
        // Find the block again: earlier edits may have moved it.
        const current = findConflicts(view.state.doc.toString())[this.index];
        if (current) view.dispatch({ changes: { from: current.from, to: current.to, insert: resolution(current, choice) } });
      };
      lens.append(link);
    });
    return lens;
  }

  ignoreEvent() {
    return true;
  }
}

/** "(Current Change)" after the `<<<<<<<` marker, "(Incoming Change)" after `>>>>>>>`. */
class MarkerLabel extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: MarkerLabel) {
    return other.text === this.text;
  }
  toDOM() {
    const label = document.createElement("span");
    label.className = "conflict-marker-label";
    label.textContent = this.text;
    return label;
  }
}

function conflictDecorations(text: string): DecorationSet {
  const ranges = [];
  for (const [index, conflict] of findConflicts(text).entries()) {
    ranges.push(Decoration.widget({ widget: new ConflictLens(conflict, index), block: true, side: -1 }).range(conflict.from));
    let at = conflict.from;
    let part: "current" | "base" | "incoming" = "current";
    for (const line of text.slice(conflict.from, conflict.to).split(/(?<=\n)/)) {
      const end = at + line.replace(/\n$/, "").length;
      if (line.startsWith("<<<<<<<")) {
        ranges.push(Decoration.line({ class: "cm-conflict-header current" }).range(at));
        ranges.push(Decoration.widget({ widget: new MarkerLabel("(Current Change)"), side: 1 }).range(end));
      } else if (line.startsWith("|||||||")) {
        part = "base";
        ranges.push(Decoration.line({ class: "cm-conflict-header base" }).range(at));
      } else if (line.startsWith("=======")) {
        part = "incoming";
        ranges.push(Decoration.line({ class: "cm-conflict-separator" }).range(at));
      } else if (line.startsWith(">>>>>>>")) {
        ranges.push(Decoration.line({ class: "cm-conflict-header incoming" }).range(at));
        ranges.push(Decoration.widget({ widget: new MarkerLabel("(Incoming Change)"), side: 1 }).range(end));
      } else {
        ranges.push(Decoration.line({ class: `cm-conflict-${part}` }).range(at));
      }
      at += line.length;
    }
  }
  return Decoration.set(ranges, true);
}

const conflictField = StateField.define<DecorationSet>({
  create: (state) => conflictDecorations(state.doc.toString()),
  update: (decorations, tr) => (tr.docChanged ? conflictDecorations(tr.state.doc.toString()) : decorations),
  provide: (field) => EditorView.decorations.from(field),
});

/** The conflicted file, editable, with VS Code's choices above each conflict. */
function ConflictEditor(props: {
  path: string;
  text: string;
  busy: boolean;
  viewRef: { current: EditorView | null };
  onResolve: (path: string, content: string) => Promise<boolean>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(props.text);
  const remaining = useMemo(() => findConflicts(text).length, [text]);

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.text,
        extensions: [
          // Plain text: a "=======" marker would otherwise read as a heading's underline.
          editorExtensions(true, false),
          conflictField,
          EditorView.updateListener.of((u) => u.docChanged && setText(u.state.doc.toString())),
        ],
      }),
    });
    props.viewRef.current = editor;
    return () => {
      props.viewRef.current = null;
      editor.destroy();
    };
  }, [props.text]);

  const acceptAll = useCallback(
    (choice: Resolution) => {
      const editor = props.viewRef.current;
      if (!editor) return;
      const doc = editor.state.doc.toString();
      editor.dispatch({ changes: { from: 0, to: doc.length, insert: resolveAll(doc, choice) } });
    },
    [props.viewRef],
  );

  return (
    <>
      <div className={`conflict-bar ${remaining === 0 ? "done" : ""}`}>
        <span>
          {remaining === 0
            ? "All conflicts are resolved. Mark the file as resolved to stage it."
            : `${remaining} ${remaining === 1 ? "conflict" : "conflicts"} left`}
        </span>
        {remaining > 1 && (
          <>
            <button className="link-button" onClick={() => acceptAll("ours")}>
              Accept All Current
            </button>
            <button className="link-button" onClick={() => acceptAll("theirs")}>
              Accept All Incoming
            </button>
          </>
        )}
        <span className="spacer" />
        <button
          className="primary-button small"
          disabled={props.busy || remaining > 0}
          onClick={() => props.onResolve(props.path, text)}
        >
          <Check size={13} />
          Mark as Resolved
        </button>
      </div>
      <div className="diff-body conflict" ref={host} />
    </>
  );
}
