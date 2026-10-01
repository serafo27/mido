// The editor minimap's own layout of the whole document. The editor only
// measures the lines it has drawn and gives the others an average height,
// so a minimap drawn from it changed as the document was scrolled through.
// With the editor's monospaced font, wrapping can be worked out from the
// text: this layout stays put until the text or the width changes.

export const LineKind = { Text: 0, Heading: 1, Code: 2 } as const;

export interface Metrics {
  /** Height of a line of body text, in pixels. */
  lineHeight: number;
  /** Width of a character of body text. */
  charWidth: number;
  /** Width lines wrap at, or null when they don't wrap. */
  wrapWidth: number | null;
  /** Space above the first line and below the last. */
  paddingTop: number;
  paddingBottom: number;
}

export interface Layout {
  /** Top of each line (0-based), and its height. */
  tops: Float64Array;
  heights: Float64Array;
  kinds: Uint8Array;
  /** Font size of each line, relative to body text. */
  sizes: Float32Array;
  height: number;
  /** What it was laid out for. */
  metrics?: Metrics;
}

/** Font sizes of headings in the editor, relative to body text (see the editor's highlight style). */
const HEADING_SIZES = [1.3, 1.15, 1, 1, 1, 1];

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

const WORD = /[\p{L}\p{N}]/u;

/** The last place in text[start, end] a row can break after, as browsers break text: a space, or a hyphen inside a word. */
function lastBreak(text: string, start: number, end: number): number {
  for (let i = end; i > start; i--) {
    const c = text[i];
    if (c === " ") return i;
    if (c === "-" && i < end && WORD.test(text[i - 1] ?? "") && WORD.test(text[i + 1] ?? "")) return i;
  }
  return -1;
}

/**
 * The rows a line wraps into at `columns` characters, as [start, end)
 * offsets: breaking after spaces and word-inner hyphens, and inside words
 * longer than a row.
 */
export function wrapRows(text: string, columns: number): [number, number][] {
  const rows: [number, number][] = [];
  if (columns < 1 || text.length <= columns) return [[0, text.length]];
  let start = 0;
  while (text.length - start > columns) {
    let end = start + columns;
    // Back to the last break in the row, if there is one: the word goes on the next row.
    const breakAt = lastBreak(text, start, end);
    if (breakAt > start) end = breakAt + 1;
    rows.push([start, end]);
    start = end;
    while (text[start] === " ") start++;
  }
  rows.push([start, text.length]);
  return rows;
}

/** Lays out `lines` the way the editor shows them. */
export function layoutLines(lines: string[], m: Metrics): Layout {
  const n = lines.length;
  const tops = new Float64Array(n);
  const heights = new Float64Array(n);
  const kinds = new Uint8Array(n);
  const sizes = new Float32Array(n);
  let fence: string | null = null;
  let y = m.paddingTop;
  for (let i = 0; i < n; i++) {
    const text = lines[i];
    let kind: number = LineKind.Text;
    let size = 1;
    const open = FENCE.exec(text);
    if (fence) {
      kind = LineKind.Code;
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && !text.slice(open[0].length).trim()) {
        fence = null;
      }
    } else if (open) {
      kind = LineKind.Code;
      fence = open[1];
    } else {
      const heading = /^ {0,3}(#{1,6})(\s|$)/.exec(text);
      if (heading) {
        kind = LineKind.Heading;
        size = HEADING_SIZES[heading[1].length - 1];
      }
    }
    const columns = m.wrapWidth === null ? Infinity : Math.floor(m.wrapWidth / (m.charWidth * size));
    const rows = m.wrapWidth === null ? 1 : wrapRows(text, columns).length;
    tops[i] = y;
    heights[i] = rows * m.lineHeight * size;
    kinds[i] = kind;
    sizes[i] = size;
    y += heights[i];
  }
  return { tops, heights, kinds, sizes, height: y + m.paddingBottom, metrics: m };
}

/** The line (0-based) at `y`, with the fraction of it above `y`. */
export function lineAtY(layout: Layout, y: number): number {
  const { tops, heights } = layout;
  if (tops.length === 0 || y <= tops[0]) return 0;
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo + Math.min(1, (y - tops[lo]) / Math.max(1, heights[lo]));
}

/** The position of line `line` (0-based, with a fraction) in the layout. */
export function yOfLine(layout: Layout, line: number): number {
  const { tops, heights } = layout;
  if (tops.length === 0) return 0;
  const i = Math.min(Math.max(0, Math.floor(line)), tops.length - 1);
  return tops[i] + Math.min(1, Math.max(0, line - i)) * heights[i];
}
