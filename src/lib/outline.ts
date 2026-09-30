export interface Heading {
  level: number;
  text: string;
  /** 1-based source line, matching the preview's `data-line`. */
  line: number;
}

/** Strips inline Markdown so headings read as plain text. */
function plain(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .trim();
}

/** Extracts ATX (`# Title`) and setext (`Title\n===`) headings, skipping code and frontmatter. */
export function extractHeadings(src: string): Heading[] {
  const lines = src.split(/\r?\n/);
  const headings: Heading[] = [];
  let fence: string | null = null;
  let i = 0;

  if (/^(---|\+\+\+)\s*$/.test(lines[0] ?? "")) {
    const close = lines.findIndex((l, j) => j > 0 && /^(---|\+\+\+|\.\.\.)\s*$/.test(l));
    if (close > 0) i = close + 1;
  }

  for (; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;

    const atx = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (atx) {
      const text = plain(atx[2]);
      if (text) headings.push({ level: atx[1].length, text, line: i + 1 });
      continue;
    }
    const next = lines[i + 1];
    if (next !== undefined && line.trim() && !/^ {0,3}([>*+-]|\d+[.)])\s/.test(line)) {
      const setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(next);
      if (setext) {
        headings.push({ level: setext[1][0] === "=" ? 1 : 2, text: plain(line), line: i + 1 });
        i++;
      }
    }
  }
  return headings;
}

/** Index of the heading whose section contains `line` (the first one above all headings). */
export function headingAt(headings: Heading[], line: number): number {
  let index = headings.length ? 0 : -1;
  for (let i = 0; i < headings.length && headings[i].line <= line; i++) index = i;
  return index;
}
