// Markdown formatting commands for the editor and its format bar, and what
// formatting the cursor is in (to light up the bar's buttons).
import { redoDepth, undoDepth } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type Line, type Text } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";

/** Toggles `marker` around each selection (e.g. `**` for bold). */
export function toggleMarker(marker: string): Command {
  return (view) => {
    const { state } = view;
    const n = marker.length;
    view.dispatch(
      state.changeByRange((range) => {
        const before = state.sliceDoc(range.from - n, range.from);
        const after = state.sliceDoc(range.to, range.to + n);
        if (before === marker && after === marker && !insideLongerRun(state, range.from, range.to, marker)) {
          return {
            changes: [
              { from: range.from - n, to: range.from },
              { from: range.to, to: range.to + n },
            ],
            range: EditorSelection.range(range.from - n, range.to - n),
          };
        }
        // The selection itself is wrapped: unwrap it.
        const text = state.sliceDoc(range.from, range.to);
        if (text.length >= 2 * n && text.startsWith(marker) && text.endsWith(marker)) {
          return {
            changes: { from: range.from, to: range.to, insert: text.slice(n, -n) },
            range: EditorSelection.range(range.from, range.to - 2 * n),
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
      { userEvent: "input.format" },
    );
    return true;
  };
}

/**
 * Whether the `*` around from–to belongs to a `**` (bold, not italic): an
 * even run of them on both sides.
 */
function insideLongerRun(state: EditorState, from: number, to: number, marker: string): boolean {
  if (marker !== "*") return false;
  const run = (pos: number, step: 1 | -1) => {
    let n = 0;
    while (state.sliceDoc(pos + (step < 0 ? -n - 1 : n), pos + (step < 0 ? -n : n + 1)) === "*") n++;
    return n;
  };
  return run(from, -1) % 2 === 0 || run(to, 1) % 2 === 0;
}

export const toggleBold = toggleMarker("**");
export const toggleItalic = toggleMarker("*");
export const toggleStrikethrough = toggleMarker("~~");
export const toggleInlineCode = toggleMarker("`");

/** Wraps the selection in a link, selecting the URL to type over. */
export const insertLink: Command = (view) => {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to);
      const insert = `[${text}](url)`;
      const urlStart = range.from + text.length + 3;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: text ? EditorSelection.range(urlStart, urlStart + 3) : EditorSelection.cursor(range.from + 1),
      };
    }),
    { userEvent: "input.format" },
  );
  return true;
};

/** The lines touched by the selection, each once, in order. */
function selectedLines(state: EditorState): Line[] {
  const lines: Line[] = [];
  let last = -1;
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    // A selection ending at a line's start doesn't take that line.
    const end = state.doc.lineAt(range.to);
    const lastLine = range.to > range.from && end.from === range.to ? end.number - 1 : end.number;
    for (let n = Math.max(first, last + 1); n <= Math.max(first, lastLine); n++) {
      lines.push(state.doc.line(n));
      last = n;
    }
  }
  return lines;
}

/** Replaces each selected line's `prefix` (matched at its start) with what `next` returns. */
function rewritePrefixes(view: EditorView, pattern: RegExp, next: (match: RegExpExecArray, index: number) => string) {
  const changes = selectedLines(view.state).map((line, i) => {
    const match = pattern.exec(line.text)!;
    return { from: line.from, to: line.from + match[0].length, insert: next(match, i) };
  });
  view.dispatch({ changes, scrollIntoView: true, userEvent: "input.format" });
  view.focus();
}

const HEADING = /^(\s{0,3})(#{1,6}[ \t]+|)/;

/** Makes the selected lines a heading of `level`, or plain paragraphs with 0. */
export function setHeading(level: number): Command {
  return (view) => {
    rewritePrefixes(view, HEADING, (m) => m[1] + (level ? "#".repeat(level) + " " : ""));
    return true;
  };
}

/** The heading level of the line at the cursor; 0 for none. */
export function headingLevel(state: EditorState): number {
  const line = state.doc.lineAt(state.selection.main.head);
  return /^\s{0,3}(#{1,6})(?:[ \t]|$)/.exec(line.text)?.[1].length ?? 0;
}

export type ListKind = "bullet" | "ordered" | "task" | "quote";

// Indentation, then any list marker (with a task box) or quote marker.
const LINE_PREFIX = /^(\s*)((?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|>[ \t]?|)/;
const KIND: Record<ListKind, RegExp> = {
  bullet: /^[-*+][ \t]+(?!\[[ xX]\])/,
  ordered: /^\d{1,9}[.)][ \t]+/,
  task: /^(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\]/,
  quote: /^>/,
};

/** The kind of the line's list or quote marker, if it has one. */
export function lineKind(text: string): ListKind | null {
  const marker = text.trimStart();
  return (Object.keys(KIND) as ListKind[]).find((kind) => KIND[kind].test(marker)) ?? null;
}

/**
 * Makes the selected lines a list (or a quote) of `kind`; when they all are
 * already, turns them back into plain lines.
 */
export function toggleList(kind: ListKind): Command {
  return (view) => {
    const lines = selectedLines(view.state);
    const content = lines.filter((line) => line.text.trim());
    const remove = content.length > 0 && content.every((line) => lineKind(line.text) === kind);
    let number = 0;
    rewritePrefixes(view, LINE_PREFIX, (m, i) => {
      if (remove || !lines[i].text.trim()) return m[1];
      number++;
      const marker = { bullet: "- ", ordered: `${number}. `, task: "- [ ] ", quote: "> " }[kind];
      return m[1] + marker;
    });
    return true;
  };
}

/** The list or quote the line at the cursor is in. */
export function listKind(state: EditorState): ListKind | null {
  return lineKind(state.doc.lineAt(state.selection.main.head).text);
}

/**
 * Inserts `block` on lines of its own in place of the selection, with blank
 * lines around it, and puts the cursor at `cursor` (an offset into `block`),
 * or after it.
 */
export function insertBlock(view: EditorView, block: string, cursor = block.length) {
  const { state } = view;
  const { from, to } = state.selection.main;
  const doc = state.doc;
  const before = blankLinesBefore(doc, from);
  const after = blankLinesAfter(doc, to);
  const insert = before + block + after;
  const anchor = from + before.length + cursor;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  view.focus();
}

/** What to put before a block inserted at `pos` so a blank line sets it apart (none at the document's start). */
function blankLinesBefore(doc: Text, pos: number): string {
  if (pos === 0) return "";
  const text = doc.sliceString(Math.max(0, pos - 2), pos);
  if (text.endsWith("\n\n") || (pos === 1 && text === "\n")) return "";
  return text.endsWith("\n") ? "\n" : "\n\n";
}

function blankLinesAfter(doc: Text, pos: number): string {
  const text = doc.sliceString(pos, pos + 2);
  if (pos === doc.length) return "\n";
  if (text.startsWith("\n\n")) return "";
  return text.startsWith("\n") ? "\n" : "\n\n";
}

/** Wraps the selection in a fenced code block (of `language`), or inserts an empty one. */
export function insertCodeBlock(language = ""): Command {
  return (view) => {
    const { from, to } = view.state.selection.main;
    const text = view.state.sliceDoc(from, to);
    const open = "```" + language + "\n";
    insertBlock(view, `${open}${text}\n\`\`\``, open.length + text.length);
    return true;
  };
}

/** A Markdown table with a header row and `rows` empty rows of `columns` cells. */
export function tableMarkdown(rows: number, columns: number): string {
  const row = (cell: (i: number) => string) => "| " + Array.from({ length: columns }, (_, i) => cell(i)).join(" | ") + " |";
  const header = row((i) => `Column ${i + 1}`);
  const rule = row(() => "--------");
  const body = Array.from({ length: rows }, () => row(() => "        "));
  return [header, rule, ...body].join("\n");
}

/** Inserts a table, selecting its first header cell. */
export function insertTable(rows: number, columns: number): Command {
  return (view) => {
    insertBlock(view, tableMarkdown(rows, columns), 2);
    const head = view.state.selection.main.head;
    view.dispatch({ selection: { anchor: head, head: head + "Column 1".length } });
    return true;
  };
}

export const insertRule: Command = (view) => {
  insertBlock(view, "---");
  return true;
};

export const insertMath: Command = (view) => {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  insertBlock(view, `$$\n${text}\n$$`, 3 + text.length);
  return true;
};

export const insertDiagram: Command = (view) => {
  const body = "flowchart LR\n  A[Start] --> B[End]";
  insertBlock(view, "```mermaid\n" + body + "\n```", 11 + body.length);
  return true;
};

/** Adds a footnote reference at the cursor and its note at the end of the document, then goes to the note. */
export const insertFootnote: Command = (view) => {
  const { state } = view;
  const used = new Set([...state.doc.toString().matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1])));
  let n = 1;
  while (used.has(n)) n++;
  const ref = `[^${n}]`;
  const at = state.selection.main.to;
  const end = state.doc.length;
  const tail = state.doc.sliceString(Math.max(0, end - 2), end);
  const gap = end === 0 ? "" : tail.endsWith("\n\n") ? "" : tail.endsWith("\n") ? "\n" : "\n\n";
  const note = `${gap}${ref}: `;
  view.dispatch({
    changes: [
      { from: at, insert: ref },
      { from: end, insert: note },
    ],
    selection: { anchor: end + ref.length + note.length },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  view.focus();
  return true;
};

export interface FormatState {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  code: boolean;
  link: boolean;
  /** 1–6, or 0 outside headings. */
  heading: number;
  list: ListKind | null;
  codeBlock: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export const EMPTY_FORMAT: FormatState = {
  bold: false,
  italic: false,
  strikethrough: false,
  code: false,
  link: false,
  heading: 0,
  list: null,
  codeBlock: false,
  canUndo: false,
  canRedo: false,
};

interface TreeNode {
  name: string;
  from: number;
  to: number;
  parent: TreeNode | null;
}

/** The formatting at the cursor, from the Markdown syntax tree. */
export function formatAt(state: EditorState): FormatState {
  const format = {
    ...EMPTY_FORMAT,
    heading: headingLevel(state),
    list: listKind(state),
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
  };
  const head = state.selection.main.head;
  // Both sides, so a cursor right after `**bold**`'s text still counts.
  for (const side of [-1, 1] as const) {
    for (let node: TreeNode | null = syntaxTree(state).resolveInner(head, side); node; node = node.parent) {
      switch (node.name) {
        case "StrongEmphasis":
          format.bold ||= node.from < head && node.to > head;
          break;
        case "Emphasis":
          format.italic ||= node.from < head && node.to > head;
          break;
        case "Strikethrough":
          format.strikethrough ||= node.from < head && node.to > head;
          break;
        case "InlineCode":
          format.code ||= node.from < head && node.to > head;
          break;
        case "Link":
          format.link ||= node.from < head && node.to > head;
          break;
        case "FencedCode":
        case "CodeBlock":
          format.codeBlock = true;
          break;
      }
    }
  }
  return format;
}

export function sameFormat(a: FormatState, b: FormatState): boolean {
  return (Object.keys(a) as (keyof FormatState)[]).every((key) => a[key] === b[key]);
}
