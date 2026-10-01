import { useEffect, useRef } from "react";
import { basicSetup } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, keymap, type Command, type DecorationSet } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { imageFiles } from "../lib/images";
import type { SourceHighlight } from "../lib/previewComments";

interface EditorProps {
  /** Identifies the document (the tab's path); each gets its own state. */
  docKey: string;
  value: string;
  wrap: boolean;
  onChange: (docKey: string, value: string) => void;
  onScroll?: (view: EditorView) => void;
  /** Saves images pasted or dropped into the document; resolves to the Markdown to insert. */
  onAddImages?: (docKey: string, files: File[]) => Promise<string | null>;
  /** Commented text to highlight. */
  highlights?: SourceHighlight[];
  /** A highlight was clicked. */
  onSelectHighlight?: (id: string) => void;
}

// Colors come from CSS variables so the editor follows the app theme for free.
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--editor-font-size)",
    color: "var(--text)",
    backgroundColor: "var(--bg-editor)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--md-font-code)",
    lineHeight: "1.75",
  },
  ".cm-content": {
    padding: "40px 36px 50vh",
    caretColor: "var(--accent)",
  },
  ".cm-content.cm-lineWrapping": {
    maxWidth: "860px",
    margin: "0 auto",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
    { backgroundColor: "var(--selection) !important" },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-gutters": { display: "none" },
  ".cm-matchingBracket": { backgroundColor: "var(--accent-soft)", outline: "none" },
  ".cm-searchMatch": { backgroundColor: "var(--search-match)" },
  ".cm-comment-highlight": {
    backgroundColor: "var(--comment-highlight)",
    borderBottom: "2px solid var(--comment-underline)",
    cursor: "pointer",
  },
  ".cm-comment-highlight.active": { backgroundColor: "var(--comment-highlight-active)" },
  ".cm-panels": { backgroundColor: "var(--bg-sidebar)", color: "var(--text)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-textfield": {
    backgroundColor: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "5px",
    color: "var(--text)",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--bg-elev)",
    border: "1px solid var(--border)",
    borderRadius: "5px",
    color: "var(--text)",
  },
});

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "700", fontSize: "1.3em", color: "var(--md-heading)" },
  { tag: t.heading2, fontWeight: "700", fontSize: "1.15em", color: "var(--md-heading)" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "650", color: "var(--md-heading)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--text-muted)", textDecoration: "underline" },
  { tag: t.monospace, color: "var(--hl-string)" },
  { tag: t.quote, color: "var(--text-muted)", fontStyle: "italic" },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: "var(--text-faint)" },
  { tag: t.list, color: "var(--text)" },
  // Fenced code blocks.
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "var(--hl-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--hl-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--hl-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--hl-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--hl-title)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--hl-type)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--hl-attr)" },
  { tag: [t.tagName], color: "var(--hl-keyword)" },
]);

/* ---------- comment highlights ---------- */

const setHighlights = StateEffect.define<SourceHighlight[]>();

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    // Follow edits until the app sends the highlights found in the new text.
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setHighlights)) continue;
      const length = tr.state.doc.length;
      const marks = effect.value
        .map((h) => ({ ...h, from: Math.min(h.from, length), to: Math.min(h.to, length) }))
        .filter((h) => h.from < h.to)
        .sort((a, b) => a.from - b.from)
        .map((h) =>
          Decoration.mark({
            class: h.active ? "cm-comment-highlight active" : "cm-comment-highlight",
            id: h.id,
          }).range(h.from, h.to),
        );
      decorations = Decoration.set(marks, true);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The comment highlight at `pos`, preferring the shortest. */
function highlightAtPos(state: EditorState, pos: number): string | null {
  let found: { id: string; length: number } | null = null;
  state.field(highlightField).between(pos, pos, (from, to, deco) => {
    if (from <= pos && pos <= to && (!found || to - from < found.length)) {
      found = { id: deco.spec.id as string, length: to - from };
    }
  });
  return (found as { id: string } | null)?.id ?? null;
}

/** Toggles `marker` around each selection (e.g. `**` for bold). */
function toggleMarker(marker: string): Command {
  return (view) => {
    const { state } = view;
    const n = marker.length;
    view.dispatch(
      state.changeByRange((range) => {
        const before = state.sliceDoc(range.from - n, range.from);
        const after = state.sliceDoc(range.to, range.to + n);
        if (before === marker && after === marker) {
          return {
            changes: [
              { from: range.from - n, to: range.from },
              { from: range.to, to: range.to + n },
            ],
            range: EditorSelection.range(range.from - n, range.to - n),
          };
        }
        return {
          changes: [
            { from: range.from, insert: marker },
            { from: range.to, insert: marker },
          ],
          range: EditorSelection.range(range.from + n, range.to + n),
        };
      }),
    );
    return true;
  };
}

const insertLink: Command = (view) => {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to);
      const insert = `[${text}](url)`;
      const urlStart = range.from + text.length + 3;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: text
          ? EditorSelection.range(urlStart, urlStart + 3)
          : EditorSelection.cursor(range.from + 1),
      };
    }),
  );
  return true;
};

const markdownKeys = Prec.high(
  keymap.of([
    { key: "Mod-b", run: toggleMarker("**") },
    { key: "Mod-i", run: toggleMarker("*") },
    { key: "Mod-Shift-x", run: toggleMarker("~~") },
    { key: "Mod-k", run: insertLink },
  ]),
);

/*
 * One EditorView is reused across tabs; each document keeps its own
 * EditorState (undo history, selection) and scroll offset here, so switching
 * tabs — or toggling read mode — never loses them.
 */
const docStates = new Map<string, { state: EditorState; scrollTop: number }>();

export function forgetEditorState(docKey: string) {
  docStates.delete(docKey);
}

export function renameEditorState(from: string, to: string) {
  for (const [key, value] of [...docStates]) {
    if (key === from || key.startsWith(from + "/") || key.startsWith(from + "\\")) {
      docStates.delete(key);
      docStates.set(to + key.slice(from.length), value);
    }
  }
}

const wrapCompartment = new Compartment();

let currentView: EditorView | null = null;

/** Moves the cursor to the start of `line` and scrolls it to the top of the editor. */
export function revealEditorLine(line: number) {
  const view = currentView;
  if (!view) return;
  // Focus first: regaining focus restores the old DOM selection, which must
  // not win over the new cursor position.
  view.focus();
  const pos = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines)).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 32 }),
  });
}

/** Selects `from`–`to` and scrolls it into view. */
export function revealEditorRange(from: number, to: number) {
  const view = currentView;
  if (!view) return;
  const length = view.state.doc.length;
  view.focus();
  view.dispatch({
    selection: { anchor: Math.min(from, length), head: Math.min(to, length) },
    effects: EditorView.scrollIntoView(Math.min(from, length), { y: "center" }),
  });
}

/** The editor's selection, if it has focus and something is selected. */
export function editorSelection(): { from: number; to: number } | null {
  const view = currentView;
  if (!view || !view.hasFocus) return null;
  const { from, to } = view.state.selection.main;
  return from < to ? { from, to } : null;
}

export interface LineRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The first line of the editor's selection, in window coordinates. */
export function editorSelectionLine(): LineRect | null {
  const view = currentView;
  const range = editorSelection();
  if (!view || !range) return null;
  const start = view.coordsAtPos(range.from, 1);
  const end = view.coordsAtPos(range.to, -1);
  if (!start) return null;
  // On one line, centre over the selection; otherwise over its first line's start.
  const right = end && Math.abs(end.top - start.top) < 2 ? end.right : start.left;
  return { left: start.left, right, top: start.top, bottom: start.bottom };
}

/** First source line visible at the top of the editor. */
export function editorTopLine(view: EditorView): number {
  return view.state.doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.scrollTop).from).number;
}

export default function Editor(props: EditorProps) {
  const { docKey, value, wrap, onChange, onScroll, onAddImages, highlights, onSelectHighlight } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const keyRef = useRef(docKey);
  const callbacks = useRef({ onChange, onScroll, onAddImages, onSelectHighlight });
  callbacks.current = { onChange, onScroll, onAddImages, onSelectHighlight };
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;
  const wrapRef = useRef(wrap);
  wrapRef.current = wrap;

  /** Saves `files`, then inserts their links at `at` (a drop) or over the selection (a paste). */
  const addImages = async (view: EditorView, files: File[], at: number | null) => {
    const key = keyRef.current;
    const text = await callbacks.current.onAddImages?.(key, files);
    // Another document may be showing by the time the images are saved.
    if (!text || keyRef.current !== key || viewRef.current !== view) return;
    if (at === null) {
      view.dispatch(view.state.replaceSelection(text));
    } else {
      const pos = Math.min(at, view.state.doc.length);
      view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
    }
    view.focus();
  };

  const createState = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        basicSetup({
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
        }),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        editorTheme,
        syntaxHighlighting(highlight),
        markdownKeys,
        highlightField,
        wrapCompartment.of(wrapRef.current ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(keyRef.current, update.state.doc.toString());
        }),
        EditorView.domEventObservers({
          scroll: (_e, view) => callbacks.current.onScroll?.(view),
          click: (event, view) => {
            if (!view.state.selection.main.empty) return;
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            const id = pos === null ? null : highlightAtPos(view.state, pos);
            if (id) callbacks.current.onSelectHighlight?.(id);
          },
        }),
        // Ahead of CodeMirror's own drop handling, which would paste a dropped file's bytes as text.
        Prec.high(
          EditorView.domEventHandlers({
            paste: (event, view) => {
              const files = imageFiles(event.clipboardData);
              // Text wins when there is some: copying from a web page often carries an image too.
              if (files.length === 0 || event.clipboardData?.getData("text/plain")) return false;
              event.preventDefault();
              addImages(view, files, null);
              return true;
            },
            drop: (event, view) => {
              const files = imageFiles(event.dataTransfer);
              if (files.length === 0) return false;
              event.preventDefault();
              addImages(view, files, view.posAtCoords({ x: event.clientX, y: event.clientY }));
              return true;
            },
          }),
        ),
      ] satisfies Extension[],
    });

  // Brings a cached state in line with the current props before showing it.
  const restore = (view: EditorView, key: string, doc: string) => {
    const cached = docStates.get(key);
    const state = cached?.state ?? createState(doc);
    view.setState(state);
    view.dispatch({ effects: wrapCompartment.reconfigure(wrapRef.current ? EditorView.lineWrapping : []) });
    if (cached && state.doc.toString() !== doc) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
    }
    view.dispatch({ effects: setHighlights.of(highlightsRef.current ?? []) });
    const top = cached?.scrollTop ?? 0;
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = top;
    });
  };

  const stash = (view: EditorView, key: string) => {
    docStates.set(key, { state: view.state, scrollTop: view.scrollDOM.scrollTop });
  };

  useEffect(() => {
    const view = new EditorView({ parent: hostRef.current! });
    viewRef.current = view;
    currentView = view;
    restore(view, keyRef.current, value);
    view.focus();
    return () => {
      stash(view, keyRef.current);
      view.destroy();
      viewRef.current = null;
      if (currentView === view) currentView = null;
    };
  }, []);

  // Switch documents.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || keyRef.current === docKey) return;
    stash(view, keyRef.current);
    keyRef.current = docKey;
    restore(view, docKey, value);
  }, [docKey]);

  // External changes (e.g. the file was reloaded from disk).
  useEffect(() => {
    const view = viewRef.current;
    if (view && keyRef.current === docKey && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value, docKey]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && keyRef.current === docKey) view.dispatch({ effects: setHighlights.of(highlights ?? []) });
  }, [highlights, docKey]);

  return <div className="editor" ref={hostRef} />;
}

/** Re-measures editors after font settings change. */
export function useEditorRemeasure(deps: unknown[]) {
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(".cm-editor").forEach((el) => {
      EditorView.findFromDOM(el)?.requestMeasure();
    });
  }, deps);
}
