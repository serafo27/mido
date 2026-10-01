// Renders Markdown for the preview the way react-markdown does with the same
// plugins, but a block at a time, so an edit only re-renders what it changed.
//
// - The source is split into chunks at blank lines where no construct can
//   continue (see `splitChunks`), and each chunk is parsed on its own, cached
//   by its text. Parsing is the slowest step for a whole document.
// - The chunks' trees are joined and turned into HTML trees as one document,
//   so footnote numbers and links to definitions come out as they would.
// - Top-level blocks are then sanitized, typeset (math, code) and turned into
//   React elements one group at a time, cached by their content; a group
//   spans blocks that raw HTML ties together (`<div>` … `</div>`).
// - Heading ids, which are deduplicated across the document, and source
//   lines are applied last, so moving a block doesn't re-render it.
import { cloneElement, isValidElement, type ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import type { Element, ElementContent, Root as HastRoot, RootContent as HastContent } from "hast";
import type { Root as MdastRoot, RootContent as MdastContent } from "mdast";
import { unified, type PluggableList } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { toJsxRuntime, type Components } from "hast-util-to-jsx-runtime";
import { toString } from "hast-util-to-string";
import { urlAttributes } from "html-url-attributes";
import GithubSlugger from "github-slugger";
import { defaultUrlTransform } from "react-markdown";
import { visit } from "unist-util-visit";
import { rehypeAfterSlug, rehypeBeforeSlug, remarkPlugins, remarkPluginsAfterStart, tagNestedLines } from "./markdown";

/* ---------- splitting the source ---------- */

export interface Chunk {
  text: string;
  /** Offset and 1-based line where the chunk starts in the source. */
  offset: number;
  line: number;
}

const BLANK = /^[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const MATH_OPEN = /^ {0,3}(\${2,})[^$]*$/;
// HTML blocks that may contain blank lines (CommonMark types 1–5), with what ends them.
const HTML_BLOCKS: [RegExp, RegExp][] = [
  [/^ {0,3}<(script|pre|style|textarea)(\s|>|$)/i, /<\/(script|pre|style|textarea)>/i],
  [/^ {0,3}<!--/, /-->/],
  [/^ {0,3}<\?/, /\?>/],
  [/^ {0,3}<![A-Za-z]/, />/],
  [/^ {0,3}<!\[CDATA\[/, /\]\]>/],
];
// A chunk may start at a line that ends whatever came before it: not
// indented (a continuation) and not a list item (which may belong to the
// list above, making it loose).
const CHUNK_START = /^(?![ \t]|[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$))/;

/**
 * Splits Markdown into chunks meant to parse the same on their own as within
 * the document: each starts after a blank line, outside any fence, math
 * block, multi-line HTML block or frontmatter, at a line that closes every
 * open container. The scan is approximate (a fence inside an HTML block
 * looks like one to it): the renderer checks each chunk as it parses it.
 */
export function splitChunks(src: string): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  let startLine = 1;
  let fence: { char: string; length: number } | null = null;
  let math = 0;
  let htmlEnd: RegExp | null = null;
  let frontmatter: RegExp | null = null;
  let previousBlank = false;

  // Lines end at \n, \r\n or a lone \r, as in CommonMark.
  const ending = /\r\n?|\n/g;
  let line = 1;
  for (let pos = 0; pos < src.length; line++) {
    ending.lastIndex = pos;
    const found = ending.exec(src);
    const end = found ? found.index + found[0].length : src.length;
    const text = src.slice(pos, found ? found.index : src.length);
    const blank = BLANK.test(text);

    const inside = fence || math || htmlEnd || frontmatter;
    if (!inside && previousBlank && !blank && pos > start && CHUNK_START.test(text)) {
      chunks.push({ text: src.slice(start, pos), offset: start, line: startLine });
      start = pos;
      startLine = line;
    }

    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
    } else if (math) {
      const close = /^ {0,3}(\${2,})[ \t]*$/.exec(text);
      if (close && close[1].length >= math) math = 0;
    } else if (htmlEnd) {
      if (htmlEnd.test(text)) htmlEnd = null;
    } else if (frontmatter) {
      if (frontmatter.test(text)) frontmatter = null;
    } else if (line === 1 && /^(---|\+\+\+)[ \t]*$/.test(text)) {
      frontmatter = text.startsWith("-") ? /^(---|\.\.\.)[ \t]*$/ : /^\+\+\+[ \t]*$/;
    } else {
      const open = FENCE_OPEN.exec(text);
      const mathOpen = MATH_OPEN.exec(text);
      if (open) {
        fence = { char: open[1][0], length: open[1].length };
      } else if (mathOpen) {
        math = mathOpen[1].length;
      } else {
        for (const [opener, closer] of HTML_BLOCKS) {
          const match = opener.exec(text);
          if (match) {
            if (!closer.test(text.slice(match[0].length))) htmlEnd = closer;
            break;
          }
        }
      }
    }
    previousBlank = blank;
    pos = end;
  }
  if (start < src.length || chunks.length === 0) chunks.push({ text: src.slice(start), offset: start, line: startLine });
  return chunks;
}

/* ---------- definitions shared across chunks ---------- */

// A line that could hold a definition, inside block quotes and list items too.
const DEFINITION = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?\[((?:[^[\]\\]|\\.)+)\]:/gm;

/** A label as mdast identifies it (a mismatch would only mean a slower full parse). */
const normalize = (label: string) =>
  label.replace(/[\t\n\r ]+/g, " ").replace(/^ | $/g, "").toLowerCase().toUpperCase().toLowerCase();

interface Definitions {
  /** Appended to a chunk with references, so they resolve like in the whole document. */
  stubs: string;
  links: Set<string>;
  footnotes: Set<string>;
}

function findDefinitions(src: string): Definitions {
  const links = new Set<string>();
  const footnotes = new Set<string>();
  let stubs = "";
  for (const [, label] of src.matchAll(DEFINITION)) {
    if (label.startsWith("^")) {
      if (footnotes.has(normalize(label.slice(1)))) continue;
      footnotes.add(normalize(label.slice(1)));
      stubs += `[${label}]: -\n`;
    } else {
      if (links.has(normalize(label))) continue;
      links.add(normalize(label));
      stubs += `[${label}]: #\n`;
    }
  }
  return { stubs, links, footnotes };
}

/* ---------- caches ---------- */

interface ParsedChunk {
  /** With positions in the document, for the place it was last used at. */
  children: MdastContent[];
  at: { line: number; offset: number };
  /** Definitions it makes, and references it uses, by kind and identifier. */
  defines: string[];
  references: string[];
  /**
   * Where a construct starts that the chunk leaves open (an unclosed fence),
   * taking in what follows it: the chunk can't stand on its own.
   */
  openAt?: number;
}

interface Group {
  id: number;
  /** Rendered, with ids and lines not yet applied. */
  nodes: HastContent[];
  /** Source line its first node had when rendered. */
  base: number;
  /** Headings that get an id, by the path to them in `nodes`. */
  headings: { path: number[]; text: string }[];
  /** React elements for `nodes`, for some heading ids and components. */
  elements?: { ids: string; components: Components; nodes: ReactNode[] };
}

/** A cache that keeps only what the latest render used. */
class Generations<V> {
  private current = new Map<string, V>();
  private next = new Map<string, V>();

  get(key: string): V | undefined {
    const value = this.next.get(key) ?? this.current.get(key);
    if (value !== undefined) this.next.set(key, value);
    return value;
  }

  set(key: string, value: V) {
    this.next.set(key, value);
  }

  /** Drops what wasn't used since the last call. */
  sweep() {
    this.current = this.next;
    this.next = new Map();
  }
}

/* ---------- the renderer ---------- */

// Ends every chunk parsed: a construct the chunk leaves open takes it in.
const END = "[mido:chunk-end]: #\n";

const firstProcessor = unified().use(remarkParse).use(remarkPlugins as PluggableList);
const restProcessor = unified().use(remarkParse).use(remarkPluginsAfterStart as PluggableList);
const toHast = unified().use(remarkRehype, { allowDangerousHtml: true });
const beforeSlug = unified().use(rehypeBeforeSlug as PluggableList);
const afterSlug = unified().use(rehypeAfterSlug as PluggableList);

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

/** Counts the elements raw HTML opens and closes, by name, into `open`. */
function trackTags(html: string, open: Map<string, number>) {
  for (const [, close, tag, selfClosing] of html.replace(/<!--[\s\S]*?(-->|$)/g, "").matchAll(
    /<(\/?)([A-Za-z][\w-]*)(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/g,
  )) {
    const name = tag.toLowerCase();
    if (VOID.has(name) || selfClosing) continue;
    const count = open.get(name) ?? 0;
    // A closing tag with nothing to close is ignored, as browsers do.
    if (close) {
      if (count > 1) open.set(name, count - 1);
      else open.delete(name);
    } else {
      open.set(name, count + 1);
    }
  }
}


type Position = NonNullable<HastContent["position"]>;

const lineOf = (node: HastContent | MdastContent): number | undefined => node.position?.start.line;

/** Moves a chunk's tree to where the chunk now is in the document, adjusting its positions in place. */
function moveTo(parsed: ParsedChunk, chunk: Chunk) {
  const lines = chunk.line - parsed.at.line;
  const offset = chunk.offset - parsed.at.offset;
  if (lines === 0 && offset === 0) return;
  const moved = new Set<object>();
  for (const child of parsed.children) {
    visit(child, (node) => {
      for (const point of [node.position?.start, node.position?.end]) {
        if (!point || moved.has(point)) continue;
        moved.add(point);
        point.line += lines;
        if (point.offset !== undefined) point.offset += offset;
      }
    });
  }
  parsed.at = { line: chunk.line, offset: chunk.offset };
}

const NO_COMPONENTS: Components = {};

/**
 * Parses Markdown with the preview's plugins, a chunk at a time: chunks
 * unchanged since the last parse come from a cache. The tree it returns is
 * the cache's, valid until the next parse.
 */
export class MarkdownParser {
  private chunks = new Generations<ParsedChunk>();

  /** The document's syntax tree, as the preview's plugins parse it. */
  parse(source: string): MdastRoot {
    const root = this.parseChunks(source);
    this.chunks.sweep();
    return root;
  }

  private parseChunks(source: string): MdastRoot {
    const definitions = findDefinitions(source);
    const whole = () => firstProcessor.runSync(firstProcessor.parse(source)) as MdastRoot;
    const children: MdastContent[] = [];
    const defined = new Set<string>();
    const referenced = new Set<string>();
    const used = new Set<ParsedChunk>();
    const chunks = splitChunks(source);
    for (let i = 0; i < chunks.length; i++) {
      let chunk = chunks[i];
      let parsed = this.parseChunk(chunk, definitions.stubs);
      // It runs on into the next chunk: the split was wrong, parse them together.
      while (parsed.openAt !== undefined && i + 1 < chunks.length) {
        const next = chunks[++i];
        chunk = { text: chunk.text + next.text, offset: chunk.offset, line: chunk.line };
        parsed = this.parseChunk(chunk, definitions.stubs);
      }
      if (parsed.openAt !== undefined) {
        // Open to the end of the document (a fence being typed), it took in
        // the definitions appended to it. Without them, references before it
        // wouldn't resolve.
        if (chunk.text.slice(0, parsed.openAt).includes("[")) return whole();
        parsed = this.parseChunk(chunk, null);
      }
      // The same text twice in the document: the second needs positions of its own.
      if (used.has(parsed)) parsed = structuredClone(parsed);
      used.add(parsed);
      moveTo(parsed, chunk);
      children.push(...parsed.children);
      for (const d of parsed.defines) defined.add(d);
      for (const r of parsed.references) referenced.add(r);
    }
    // A definition found where the scan didn't expect it (or the other way
    // round) could change how references parse: fall back to the whole document.
    const expected = [...definitions.links].map((l) => `link:${l}`).concat(
      [...definitions.footnotes].map((f) => `footnote:${f}`),
    );
    const consistent =
      [...defined].every((d) => expected.includes(d)) && [...referenced].every((r) => defined.has(r));
    return consistent ? { type: "root", children } : whole();
  }

  /**
   * Parses a chunk followed by `stubs` (if it has brackets) and an end
   * marker, which shows whether the chunk closes everything it opens.
   * With `stubs` null, parses the chunk alone.
   */
  private parseChunk(chunk: Chunk, stubs: string | null): ParsedChunk {
    const first = chunk.offset === 0;
    const suffix = stubs === null ? "" : `\n\n${chunk.text.includes("[") ? stubs : ""}${END}`;
    const key = `${first ? "F" : "R"}${suffix}\u0000${chunk.text}`;
    const cached = this.chunks.get(key);
    if (cached) return cached;

    const processor = first ? firstProcessor : restProcessor;
    const tree = processor.runSync(processor.parse(chunk.text + suffix)) as MdastRoot;
    const length = chunk.text.length;
    const children = tree.children.filter((n) => (n.position?.start.offset ?? 0) < length);
    const open = children.find((n) => (n.position?.end.offset ?? 0) > length);
    const defines: string[] = [];
    const references: string[] = [];
    for (const child of children) {
      visit(child, (node) => {
        if (node.type === "definition") defines.push(`link:${node.identifier}`);
        else if (node.type === "footnoteDefinition") defines.push(`footnote:${node.identifier}`);
        else if (node.type === "linkReference" || node.type === "imageReference") references.push(`link:${node.identifier}`);
        else if (node.type === "footnoteReference") references.push(`footnote:${node.identifier}`);
      });
    }
    const parsed: ParsedChunk = { children, at: { line: 1, offset: 0 }, defines, references };
    if (open) parsed.openAt = open.position?.start.offset ?? 0;
    this.chunks.set(key, parsed);
    return parsed;
  }

}

export class BlockRenderer {
  private parser = new MarkdownParser();
  private groups = new Generations<Group>();
  private nextId = 0;

  /** The rendered document, as `<ReactMarkdown>` would render it with the preview's plugins. */
  render(source: string, components: Components = NO_COMPONENTS): ReactNode[] {
    const root = this.parser.parse(source);
    const hast = toHast.runSync(root) as HastRoot;
    const nodes = this.renderGroups(hast, components);
    this.groups.sweep();
    return nodes;
  }

  private renderGroups(hast: HastRoot, components: Components): ReactNode[] {
    const out: ReactNode[] = [];
    const slugger = new GithubSlugger();
    const seen = new Map<number, number>();

    let pending: HastContent[] = [];
    // Elements raw HTML in `pending` left open: the group goes on until they close.
    const open = new Map<string, number>();
    const flush = () => {
      if (pending.length === 0) return;
      const group = this.renderGroup(pending);
      const occurrence = seen.get(group.id) ?? 0;
      seen.set(group.id, occurrence + 1);
      const ids = group.headings.map((h) => slugger.slug(h.text));
      const elements = this.elementsOf(group, ids, components);
      const shiftLines = (lineOf(pending[0]) ?? group.base) - group.base;
      elements.forEach((element, i) => {
        if (!isValidElement(element)) return out.push(element);
        const line = lineOf(group.nodes[i]);
        const props: Record<string, unknown> = { key: `${group.id}.${occurrence}.${i}` };
        if (line !== undefined) props["data-line"] = line + shiftLines;
        out.push(cloneElement(element, props));
      });
      pending = [];
      open.clear();
    };

    for (const node of hast.children) {
      // Whitespace between blocks belongs to no group, unless HTML is open.
      if (node.type === "text" && open.size === 0 && !node.value.trim()) {
        flush();
        out.push(node.value);
        continue;
      }
      pending.push(node);
      visit(node, "raw", (raw) => trackTags(raw.value, open));
      if (open.size === 0) flush();
    }
    flush();
    return out;
  }

  /** Sanitizes and typesets a group of blocks, or reuses the result for the same content. */
  private renderGroup(nodes: HastContent[]): Group {
    const base = lineOf(nodes[0]) ?? 0;
    // Positions count only as lines relative to the group, which its nested
    // blocks are tagged with: moving the group doesn't change its key.
    const key = JSON.stringify(nodes, (name, value) =>
      name === "position" ? ((value as Position | undefined)?.start.line ?? base) - base : value,
    );
    const cached = this.groups.get(key);
    if (cached) return cached;

    let tree: HastRoot = { type: "root", children: nodes };
    tree = beforeSlug.runSync(tree) as HastRoot;
    for (const node of tree.children) {
      if (node.type === "element" && node.position) tagNestedLines(node, node.position.start.line);
    }
    // Heading text is read before math is typeset, as rehype-slug does.
    const headings: Group["headings"] = [];
    const walk = (children: (HastContent | ElementContent)[], path: number[]) =>
      children.forEach((child, i) => {
        if (child.type !== "element") return;
        if (/^h[1-6]$/.test(child.tagName) && !child.properties.id) {
          headings.push({ path: [...path, i], text: toString(child) });
        }
        walk(child.children, [...path, i]);
      });
    walk(tree.children, []);
    tree = afterSlug.runSync(tree) as HastRoot;
    finish(tree);

    const group: Group = { id: this.nextId++, nodes: tree.children, base, headings };
    this.groups.set(key, group);
    return group;
  }

  private elementsOf(group: Group, ids: string[], components: Components): ReactNode[] {
    const idsKey = ids.join("\u0000");
    const cached = group.elements;
    if (cached && cached.ids === idsKey && cached.components === components) return cached.nodes;
    const nodes = withIds(group, ids).map((node) =>
      node.type === "text"
        ? node.value
        : toJsxRuntime(node as Element, {
            Fragment,
            components,
            ignoreInvalidStyle: true,
            jsx,
            jsxs,
            passKeys: true,
            passNode: true,
          }),
    );
    group.elements = { ids: idsKey, components, nodes };
    return nodes;
  }
}

/** The group's nodes with heading ids set, copying only what leads to the headings. */
function withIds(group: Group, ids: string[]): HastContent[] {
  if (group.headings.length === 0) return group.nodes;
  const nodes = [...group.nodes];
  group.headings.forEach(({ path }, h) => {
    let children: (HastContent | ElementContent)[] = nodes;
    path.forEach((index, depth) => {
      const node = children[index] as Element;
      const copy: Element = { ...node, children: [...node.children] };
      if (depth === path.length - 1) copy.properties = { ...node.properties, id: ids[h] };
      children[index] = copy;
      children = copy.children;
    });
  });
  return nodes;
}

/** What react-markdown does to the tree before making elements: safe URLs, leftover raw HTML as text. */
function finish(tree: HastRoot) {
  visit(tree, (node, index, parent) => {
    if (node.type === "raw" && parent && typeof index === "number") {
      parent.children[index] = { type: "text", value: node.value };
      return index;
    }
    if (node.type === "element") {
      for (const key in urlAttributes) {
        if (!Object.hasOwn(urlAttributes, key) || !Object.hasOwn(node.properties, key)) continue;
        const test = urlAttributes[key];
        if (test === null || test.includes(node.tagName)) {
          node.properties[key] = defaultUrlTransform(String(node.properties[key] || ""));
        }
      }
    }
  });
}
