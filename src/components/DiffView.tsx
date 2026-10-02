import { useEffect, useMemo, useRef, useState } from "react";
import { Columns2, FileText, Rows2, X } from "lucide-react";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { api, type FileVersions } from "../lib/api";
import { findConflicts, resolution, resolveAll, type Conflict, type Resolution } from "../lib/conflicts";
import { useStoredState } from "../lib/useStoredState";
import { editorTheme, markdownHighlight } from "./Editor";
import type { DiffTarget } from "./SourceControl";

interface DiffViewProps {
  target: DiffTarget;
  /** Changes when the repository does, to load both versions again. */
  version: string;
  busy: boolean;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  /** Writes the resolved file and stages it; resolves to whether it worked. */
  onResolve: (path: string, content: string) => Promise<boolean>;
}

const diffTheme = EditorView.theme({
  ".cm-content": { padding: "14px 0" },
  ".cm-line": { padding: "0 20px" },
});

const baseExtensions = (editable: boolean, highlight = true): Extension[] => [
  // Conflicts stay plain text: a "=======" marker would read as a heading's underline.
  highlight ? [markdown({ base: markdownLanguage, codeLanguages: languages }), syntaxHighlighting(markdownHighlight)] : [],
  editorTheme,
  diffTheme,
  EditorView.lineWrapping,
  EditorView.editable.of(editable),
  EditorState.readOnly.of(!editable),
];

function describe(target: DiffTarget): string {
  switch (target.kind) {
    case "unstaged":
      return target.change.unstaged === "?" ? "New file, not staged" : "Changes not staged";
    case "staged":
      return "Staged changes";
    case "commit":
      return `${target.commit.short} · ${target.commit.subject}`;
    case "conflict":
      return "Merge conflict";
  }
}

export default function DiffView(props: DiffViewProps) {
  const { target } = props;
  const { change } = target;
  const [versions, setVersions] = useState<FileVersions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useStoredState<"split" | "unified">("mido.diffLayout", "split");

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

  return (
    <div className="diff-view">
      <header className="diff-header">
        <div className="diff-title">
          <span className="diff-path" title={change.path}>
            {change.origPath ? `${change.origPath} → ${change.path}` : change.path}
          </span>
          <span className="diff-what">{describe(target)}</span>
        </div>
        {target.kind !== "conflict" && (
          <div className="segmented small">
            <button
              className={layout === "split" ? "selected" : ""}
              onClick={() => setLayout("split")}
              title="Side by side"
              aria-label="Side by side"
            >
              <Columns2 size={14} />
            </button>
            <button
              className={layout === "unified" ? "selected" : ""}
              onClick={() => setLayout("unified")}
              title="Inline"
              aria-label="Inline"
            >
              <Rows2 size={14} />
            </button>
          </div>
        )}
        {change.local && target.kind !== "commit" && (
          <button className="ghost-button small" onClick={() => props.onOpenFile(change.local!)}>
            <FileText size={13} />
            Open File
          </button>
        )}
        <button className="icon-button" onClick={props.onClose} title="Close (Esc)" aria-label="Close">
          <X size={15} />
        </button>
      </header>
      {error ? (
        <p className="diff-message">{error}</p>
      ) : !versions ? null : versions.binary ? (
        <p className="diff-message">This file isn't text, or it's too big to compare.</p>
      ) : target.kind === "conflict" ? (
        <ConflictEditor
          key={`${change.path}:${props.version}`}
          path={change.path}
          text={versions.modified ?? ""}
          busy={props.busy}
          onResolve={props.onResolve}
        />
      ) : (
        <Comparison
          original={versions.original ?? ""}
          modified={versions.modified ?? ""}
          layout={layout}
          sides={[
            versions.original === null ? "Doesn't exist" : target.kind === "commit" ? "Before" : target.kind === "staged" ? "Last commit" : "Staged",
            versions.modified === null ? "Deleted" : target.kind === "commit" ? "After" : target.kind === "staged" ? "Staged" : "Working copy",
          ]}
        />
      )}
    </div>
  );
}

/** Two versions, read-only: side by side, or one with the other's lines shown inline. */
function Comparison(props: { original: string; modified: string; layout: "split" | "unified"; sides: [string, string] }) {
  const host = useRef<HTMLDivElement>(null);
  const identical = props.original === props.modified;

  useEffect(() => {
    const parent = host.current;
    if (!parent || identical) return;
    const collapseUnchanged = { margin: 3, minSize: 8 };
    if (props.layout === "split") {
      const view = new MergeView({
        a: { doc: props.original, extensions: baseExtensions(false) },
        b: { doc: props.modified, extensions: baseExtensions(false) },
        parent,
        gutter: true,
        collapseUnchanged,
      });
      return () => view.destroy();
    }
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: props.modified,
        extensions: [
          baseExtensions(false),
          unifiedMergeView({ original: props.original, mergeControls: false, gutter: true, collapseUnchanged }),
        ],
      }),
    });
    return () => view.destroy();
  }, [props.original, props.modified, props.layout, identical]);

  if (identical) return <p className="diff-message">No differences.</p>;
  return (
    <>
      {props.layout === "split" && (
        <div className="diff-sides">
          <span>{props.sides[0]}</span>
          <span>{props.sides[1]}</span>
        </div>
      )}
      <div className={`diff-body ${props.layout}`} ref={host} />
    </>
  );
}

/* ---------- conflicts ---------- */

class ConflictActions extends WidgetType {
  constructor(
    readonly conflict: Conflict,
    readonly index: number,
  ) {
    super();
  }

  eq(other: ConflictActions) {
    return other.conflict.from === this.conflict.from && other.conflict.to === this.conflict.to;
  }

  toDOM(view: EditorView) {
    const bar = document.createElement("div");
    bar.className = "conflict-actions";
    const choices: [Resolution, string][] = [
      ["ours", `Keep Current${this.conflict.oursLabel ? ` (${this.conflict.oursLabel})` : ""}`],
      ["theirs", `Keep Incoming${this.conflict.theirsLabel ? ` (${this.conflict.theirsLabel})` : ""}`],
      ["both", "Keep Both"],
    ];
    for (const [choice, label] of choices) {
      const button = document.createElement("button");
      button.textContent = label;
      button.onmousedown = (e) => e.preventDefault();
      button.onclick = () => {
        // Find the block again: earlier edits may have moved it.
        const current = findConflicts(view.state.doc.toString())[this.index];
        if (!current) return;
        view.dispatch({ changes: { from: current.from, to: current.to, insert: resolution(current, choice) } });
      };
      bar.append(button);
    }
    return bar;
  }

  ignoreEvent() {
    return true;
  }
}

function conflictDecorations(text: string): DecorationSet {
  const ranges = [];
  for (const [index, conflict] of findConflicts(text).entries()) {
    ranges.push(Decoration.widget({ widget: new ConflictActions(conflict, index), block: true, side: -1 }).range(conflict.from));
    // Colour the lines of each side, and dim the marker lines.
    let at = conflict.from;
    let part: "marker" | "ours" | "base" | "theirs" = "ours";
    for (const line of text.slice(conflict.from, conflict.to).split(/(?<=\n)/)) {
      const isMarker = /^(<{7}|\|{7}|={7}|>{7})/.test(line);
      if (isMarker) {
        if (line.startsWith("|||||||")) part = "base";
        else if (line.startsWith("=======")) part = "theirs";
      }
      ranges.push(Decoration.line({ class: `cm-conflict-${isMarker ? "marker" : part}` }).range(at));
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

/** The conflicted file, editable, with a choice above each conflict. */
function ConflictEditor(props: {
  path: string;
  text: string;
  busy: boolean;
  onResolve: (path: string, content: string) => Promise<boolean>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [text, setText] = useState(props.text);
  const remaining = useMemo(() => findConflicts(text).length, [text]);

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.text,
        extensions: [
          baseExtensions(true, false),
          conflictField,
          EditorView.updateListener.of((u) => u.docChanged && setText(u.state.doc.toString())),
        ],
      }),
    });
    view.current = editor;
    return () => editor.destroy();
  }, [props.text]);

  const replaceAll = (choice: Resolution) => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: resolveAll(editor.state.doc.toString(), choice) } });
  };

  return (
    <>
      <div className="conflict-bar">
        <span>
          {remaining === 0
            ? "No conflicts left. Mark the file as resolved to stage it."
            : `${remaining} ${remaining === 1 ? "conflict" : "conflicts"} left: choose a side for each, or edit the text.`}
        </span>
        <span className="spacer" />
        {remaining > 0 && (
          <>
            <button className="ghost-button small" onClick={() => replaceAll("ours")}>
              Keep All Current
            </button>
            <button className="ghost-button small" onClick={() => replaceAll("theirs")}>
              Keep All Incoming
            </button>
          </>
        )}
        <button
          className="primary-button small"
          disabled={props.busy || remaining > 0}
          onClick={() => props.onResolve(props.path, text)}
        >
          Mark as Resolved
        </button>
      </div>
      <div className="diff-body conflict" ref={host} />
    </>
  );
}
