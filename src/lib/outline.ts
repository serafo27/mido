import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";
import { MarkdownParser } from "./blockRenderer";

export interface Heading {
  level: number;
  text: string;
  /** 1-based source line, matching the preview's `data-line`. */
  line: number;
}

/**
 * The document's headings, as the preview renders them: ATX and setext,
 * inside block quotes and lists too, never in code or frontmatter. Pass a
 * parser kept between calls to reparse only what changed.
 */
export function extractHeadings(src: string, parser = new MarkdownParser()): Heading[] {
  const headings: Heading[] = [];
  visit(parser.parse(src), "heading", (node) => {
    const text = toString(node, { includeHtml: false }).trim();
    if (text && node.position) headings.push({ level: node.depth, text, line: node.position.start.line });
  });
  return headings;
}

/** Index of the heading whose section contains `line` (the first one above all headings). */
export function headingAt(headings: Heading[], line: number): number {
  let index = headings.length ? 0 : -1;
  for (let i = 0; i < headings.length && headings[i].line <= line; i++) index = i;
  return index;
}
