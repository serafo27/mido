// Comments in the rendered preview: turning a selection on the page into a
// range of the Markdown source, and highlighting commented text. Highlights
// use the CSS Custom Highlight API, which paints ranges without changing the
// DOM that React renders; where it's missing, the preview just has none.
import { findRenderedText, lineStarts, lineAt, visibleWordsOf, wordsPattern, type Range } from "./comments";

export interface SourceHighlight extends Range {
  id: string;
  active: boolean;
}

const blockOf = (node: Node | null): HTMLElement | null =>
  (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-line]") ?? null;

/** Blocks of the preview with their source line, in page order. */
function blocks(container: HTMLElement): { el: HTMLElement; line: number }[] {
  return [...container.querySelectorAll<HTMLElement>("[data-line]")]
    // Only top-level blocks: Mermaid diagrams repeat their block's line.
    .filter((el) => !el.parentElement?.closest("[data-line]"))
    .map((el) => ({ el, line: Number(el.dataset.line) }));
}

/** The source range of the text selected in the preview, or null if there's none there. */
export function previewSelection(container: HTMLElement, source: string): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const first = blockOf(range.startContainer);
  const last = blockOf(range.endContainer);
  if (!first || !last) return null;

  const all = blocks(container);
  const top = (el: HTMLElement) => all.find((b) => b.el === el || b.el.contains(el));
  const start = top(first);
  const end = top(last);
  if (!start || !end) return null;
  const next = all[all.indexOf(end) + 1];
  const starts = lineStarts(source);
  const from = starts[start.line - 1] ?? 0;
  const to = next ? (starts[next.line - 1] ?? source.length) : source.length;
  return findRenderedText(source, selection.toString(), from, to);
}

interface TextIndex {
  text: string;
  nodes: { node: Text; start: number }[];
}

function indexText(elements: HTMLElement[]): TextIndex {
  let text = "";
  const nodes: TextIndex["nodes"] = [];
  for (const el of elements) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      nodes.push({ node, start: text.length });
      text += node.data;
    }
    // Keep words of separate blocks apart.
    text += "\n";
  }
  return { text, nodes };
}

function domPosition(index: TextIndex, offset: number): { node: Text; offset: number } | null {
  for (let i = index.nodes.length - 1; i >= 0; i--) {
    const { node, start } = index.nodes[i];
    if (start <= offset) return { node, offset: Math.min(offset - start, node.data.length) };
  }
  return null;
}

/** The page range showing the source range `range`, if it can be found. */
function pageRange(all: { el: HTMLElement; line: number }[], source: string, range: Range): globalThis.Range | null {
  const startLine = lineAt(source, range.from);
  const endLine = lineAt(source, range.to);
  // The block the range starts in, through the one it ends in.
  let first = 0;
  while (first + 1 < all.length && all[first + 1].line <= startLine) first++;
  let last = first;
  while (last + 1 < all.length && all[last + 1].line <= endLine) last++;
  const pattern = wordsPattern(visibleWordsOf(source.slice(range.from, range.to)), "[^\\p{L}\\p{N}]{0,40}?");
  if (!pattern) return null;
  const index = indexText(all.slice(first, last + 1).map((b) => b.el));
  const match = pattern.exec(index.text);
  if (!match) return null;
  const start = domPosition(index, match.index);
  const end = domPosition(index, match.index + match[0].length);
  if (!start || !end) return null;
  const result = document.createRange();
  result.setStart(start.node, start.offset);
  result.setEnd(end.node, end.offset);
  return result;
}

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

/** Painted ranges by thread, for finding the thread under a click. */
const painted = new WeakMap<HTMLElement, { id: string; range: globalThis.Range }[]>();

/** Highlights the commented text in the preview, replacing earlier highlights. */
export function paintHighlights(container: HTMLElement, source: string, highlights: SourceHighlight[]) {
  if (!supported()) return;
  const all = blocks(container);
  const ranges: { id: string; range: globalThis.Range; active: boolean }[] = [];
  for (const h of highlights) {
    const range = pageRange(all, source, h);
    if (range) ranges.push({ id: h.id, range, active: h.active });
  }
  CSS.highlights.set("mido-comment", new Highlight(...ranges.filter((r) => !r.active).map((r) => r.range)));
  CSS.highlights.set("mido-comment-active", new Highlight(...ranges.filter((r) => r.active).map((r) => r.range)));
  painted.set(container, ranges);
}

export function clearHighlights(container: HTMLElement) {
  painted.delete(container);
  if (!supported()) return;
  CSS.highlights.delete("mido-comment");
  CSS.highlights.delete("mido-comment-active");
}

/** The thread whose highlight is at the point (`x`, `y`), if any. */
export function highlightAt(container: HTMLElement, x: number, y: number): string | null {
  const ranges = painted.get(container);
  if (!ranges?.length) return null;
  const caret = document.caretRangeFromPoint?.(x, y);
  if (!caret) return null;
  const hit = ranges.find(({ range }) => {
    try {
      return range.isPointInRange(caret.startContainer, caret.startOffset);
    } catch {
      return false;
    }
  });
  return hit?.id ?? null;
}
