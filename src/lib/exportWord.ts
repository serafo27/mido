// Exports a document as a Word file (.docx), built from its Markdown syntax
// tree rather than from HTML, so it uses Word's own headings, lists,
// footnotes, equations and comments: the document's comment threads become
// Word comments, with their replies, on the same text.
import {
  AlignmentType,
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  Document,
  ExternalHyperlink,
  FootnoteReferenceRun,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  commentIdToParaId,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ICommentOptions,
  type INumberingOptions,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import type {
  BlockContent,
  Code,
  DefinitionContent,
  FootnoteDefinition,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table as MdTable,
} from "mdast";
import JSZip from "jszip";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import { hasFrontmatter, loadFrontmatterParsers, parseFrontmatter, remarkPlugins } from "./markdown";
import { wordMath } from "./mathToWord";
import { parseColor, renderMermaid, type MermaidTheme } from "./mermaid";
import { codeLanguages, codeTokens, loadLanguages } from "./shiki";
import { decodeLink, dirname, resolve } from "./paths";
import { blocksImage, type RemoteImages } from "./settings";
import type { Range, Thread } from "./comments";

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

export interface WordOptions {
  source: string;
  filePath: string;
  root: string;
  title: string;
  showFrontmatter: boolean;
  /** Turns a local file path into a URL its bytes can be fetched from. */
  assetUrl: (path: string) => string;
  remoteImages?: RemoteImages;
  /** The light theme's CSS variables: paper is light, so code, alerts and diagrams take its colours. */
  variables: Record<string, string>;
  mermaid: MermaidTheme;
  /** Comment threads, with where they are in `source` (null when their text is gone). */
  threads: { thread: Thread; range: Range | null }[];
}

/* ---------- page and text sizes ---------- */

/** Usable page width in pixels (A4 or Letter with 1" margins, at 96 dpi). */
const CONTENT_WIDTH_PX = 600;
const INDENT = 720;
const CODE_FONT = "Consolas";
const LIST_LEVELS = 9;
const BULLETS = ["•", "◦", "▪"];
/** The alerts' colours in the light themes (app.css), for themes that don't set them. */
const ALERT_COLORS: Record<string, string> = {
  "alert-note": "2F6FB3",
  "alert-tip": "2D7A4A",
  "alert-important": "7A4BB3",
  "alert-warning": "B0700F",
  "alert-caution": "B8433A",
};

/** Hex (without #) for a CSS colour, after resolving `var(--name)` with the theme's variables. */
function hexColor(css: string | undefined, variables: Record<string, string>): string | undefined {
  if (!css) return undefined;
  const name = /^var\((--[\w-]+)\)$/.exec(css.trim())?.[1];
  const value = name ? variables[name] : css;
  const rgb = value ? parseColor(value) : null;
  return rgb
    ? rgb
        .map((v) => Math.round(v).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()
    : undefined;
}

/* ---------- images ---------- */

interface Picture {
  data: Uint8Array;
  type: "png" | "jpg" | "gif" | "bmp";
  width: number;
  height: number;
}

function imageType(bytes: Uint8Array): Picture["type"] | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "gif";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  return null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((done, fail) => {
    const img = new Image();
    // An image that never loads mustn't hold up the export.
    const timer = setTimeout(() => fail(new Error(`Timed out loading ${url}`)), 15_000);
    img.onload = () => {
      clearTimeout(timer);
      done(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      fail(new Error(`Couldn't load ${url}`));
    };
    img.src = url;
  });
}

/** Draws an image (an SVG, a WebP…) on a canvas at `scale`, as a PNG. */
async function rasterize(url: string, width: number, height: number, scale = 2): Promise<Picture> {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
  if (!blob) throw new Error("Couldn't draw the image");
  return { data: new Uint8Array(await blob.arrayBuffer()), type: "png", width, height };
}

/** The image at `url`, ready for Word: formats it can't show become PNG. */
async function fetchPicture(url: string): Promise<Picture> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  const data = new Uint8Array(await blob.arrayBuffer());
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    const width = img.naturalWidth || 300;
    const height = img.naturalHeight || 150;
    const type = imageType(data);
    return type ? { data, type, width, height } : await rasterize(objectUrl, width, height);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** A Mermaid diagram as a PNG, with SVG text labels so the canvas stays readable. */
async function diagramPicture(code: string, theme: MermaidTheme): Promise<Picture> {
  const svg = await renderMermaid(code, theme, { htmlLabels: false });
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const box = root
    .getAttribute("viewBox")
    ?.split(/[\s,]+/)
    .map(Number);
  const width = box?.[2] || parseFloat(root.getAttribute("width") ?? "") || 600;
  const height = box?.[3] || parseFloat(root.getAttribute("height") ?? "") || 400;
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  root.removeAttribute("style");
  const markup = new XMLSerializer().serializeToString(root);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  return rasterize(url, width, height);
}

/** Fits a picture to the page width. */
function fit({ width, height }: { width: number; height: number }) {
  const scale = Math.min(1, CONTENT_WIDTH_PX / width);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/* ---------- comments ---------- */

interface Mark {
  offset: number;
  kind: "start" | "end";
  /** Word comment ids: a thread's first comment and its replies. */
  ids: number[];
}

/** Word comments for the threads, and where each starts and ends in the source. */
function commentMarks(threads: WordOptions["threads"]): { comments: ICommentOptions[]; marks: Mark[] } {
  const comments: ICommentOptions[] = [];
  const marks: Mark[] = [];
  let next = 0;
  for (const { thread, range } of threads) {
    if (thread.comments.length === 0) continue;
    const ids: number[] = [];
    const first = next;
    for (const comment of thread.comments) {
      const id = next++;
      ids.push(id);
      const name = comment.author.name || comment.author.email || "Mido";
      comments.push({
        id,
        author: name,
        initials: initials(name),
        date: new Date(comment.at),
        parentId: id === first ? undefined : first,
        resolved: thread.resolved || undefined,
        // Gives each comment a paragraph id, which a thread's resolved state refers to.
        durableId: commentIdToParaId(id),
        children: comment.body.split(/\r?\n/).map((line) => new Paragraph({ children: [new TextRun(line)] })),
      });
    }
    // Comments whose text is gone go at the top of the document.
    const from = range?.from ?? 0;
    const to = range?.to ?? 0;
    marks.push({ offset: from, kind: "start", ids }, { offset: to, kind: "end", ids });
  }
  // By position; at the same one, starts before ends so empty ranges stay in order.
  marks.sort((a, b) => a.offset - b.offset || (a.kind === b.kind ? 0 : a.kind === "start" ? -1 : 1));
  return { comments, marks };
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

/* ---------- conversion ---------- */

interface Inline {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: boolean;
  superScript?: boolean;
  subScript?: boolean;
}

interface Block {
  /** Left indent in twips, for quotes and list item paragraphs after the first. */
  indent: number;
  /** A quote's or an alert's left bar colour. */
  bar?: string;
  /** Numbering for the next paragraph only (a list item's first). */
  numbering?: IParagraphOptions["numbering"];
  /** Text before the next paragraph's own (a task's box). */
  lead?: string;
  bold?: boolean;
  /** No comment marks here (footnotes, which live apart from the text). */
  noMarks?: boolean;
}

type Output = (Paragraph | Table)[];

class WordConverter {
  private readonly footnoteNumbers = new Map<string, number>();
  private readonly footnoteDefinitions = new Map<string, FootnoteDefinition>();
  readonly footnotes: Record<number, { children: Paragraph[] }> = {};
  private readonly orderedLists: { reference: string; start: number }[] = [];
  private listInstance = 0;
  private markIndex = 0;

  constructor(
    private readonly o: WordOptions,
    private readonly marks: Mark[],
    private readonly pictures: Map<string, Picture | null>,
    private readonly diagrams: Map<string, Picture | null>,
  ) {}

  private color(name: string, fallback: string): string {
    return hexColor(`var(${name})`, this.o.variables) ?? fallback;
  }

  /* ----- comment marks ----- */

  private markRuns(mark: Mark): ParagraphChild[] {
    if (mark.kind === "start") return mark.ids.map((id) => new CommentRangeStart(id));
    return mark.ids.flatMap((id) => [new CommentRangeEnd(id), new CommentReference(id)]);
  }

  /** The marks next in order while `due` holds for them. */
  private takeWhile(due: (mark: Mark) => boolean): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    while (this.markIndex < this.marks.length && due(this.marks[this.markIndex])) {
      out.push(...this.markRuns(this.marks[this.markIndex++]));
    }
    return out;
  }

  /** Marks up to where something starts at `from`. */
  private before(from: number) {
    return this.takeWhile((m) => m.offset <= from);
  }

  /** Comments starting inside something that can't be split (from–to): they take all of it. */
  private startsInside(to: number) {
    return this.takeWhile((m) => m.kind === "start" && m.offset < to);
  }

  /** Marks inside something that can't be split, or ending where it ends: after it. */
  private after(to: number) {
    return this.takeWhile((m) => m.offset < to || (m.offset === to && m.kind === "end"));
  }

  /** Marks + `inner` + marks, for something from–to that comment marks can't go inside. */
  private wrapped(
    from: number | undefined,
    to: number | undefined,
    noMarks: boolean,
    inner: ParagraphChild[],
  ): ParagraphChild[] {
    if (noMarks || from === undefined || to === undefined) return inner;
    return [...this.before(from), ...this.startsInside(to), ...inner, ...this.after(to)];
  }

  /** Marks left over at the end, for the last paragraph. */
  remainingMarks(): ParagraphChild[] {
    const out = this.marks.slice(this.markIndex).flatMap((mark) => this.markRuns(mark));
    this.markIndex = this.marks.length;
    return out;
  }

  /* ----- inline ----- */

  private run(text: string, style: Inline, extra: IRunOptions = {}): TextRun {
    const codeColor = this.color("--code-fg", "8A3F5F");
    return new TextRun({
      text,
      bold: style.bold,
      italics: style.italics,
      strike: style.strike,
      superScript: style.superScript,
      subScript: style.subScript,
      ...(style.code
        ? {
            font: CODE_FONT,
            color: codeColor,
            shading: { type: ShadingType.CLEAR, fill: this.color("--code-bg", "F4F1EA"), color: "auto" },
          }
        : {}),
      ...(style.link ? { style: "Hyperlink" } : {}),
      ...extra,
    });
  }

  /**
   * A text node's runs, with comment marks at their places: inside the text
   * when it reads as written in the source, else around it.
   */
  private text(
    value: string,
    from: number | undefined,
    to: number | undefined,
    style: Inline,
    noMarks: boolean,
  ): ParagraphChild[] {
    const clean = (s: string) => s.replace(/\r?\n/g, " ");
    if (noMarks || from === undefined || to === undefined || this.o.source.slice(from, to) !== value) {
      return this.wrapped(from, to, noMarks, [this.run(clean(value), style)]);
    }
    const out: ParagraphChild[] = [...this.before(from)];
    let at = from;
    while (this.markIndex < this.marks.length && this.marks[this.markIndex].offset < to) {
      const offset = this.marks[this.markIndex].offset;
      if (offset > at) out.push(this.run(clean(value.slice(at - from, offset - from)), style));
      at = Math.max(at, offset);
      out.push(...this.markRuns(this.marks[this.markIndex++]));
    }
    if (at < to) out.push(this.run(clean(value.slice(at - from)), style));
    out.push(...this.after(to));
    return out;
  }

  /** Around a node the marks can't go inside (a link, an image). */
  private around(node: PhrasingContent, noMarks: boolean, inner: () => ParagraphChild[]): ParagraphChild[] {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (noMarks || from === undefined || to === undefined) return inner();
    const before = [...this.before(from), ...this.startsInside(to)];
    return [...before, ...inner(), ...this.after(to)];
  }

  inlines(nodes: PhrasingContent[], style: Inline, noMarks: boolean): ParagraphChild[] {
    return nodes.flatMap((node) => this.inline(node, style, noMarks));
  }

  private inline(node: PhrasingContent, style: Inline, noMarks: boolean): ParagraphChild[] {
    const pos = node.position;
    switch (node.type) {
      case "text":
        return this.text(node.value, pos?.start.offset, pos?.end.offset, style, noMarks);
      case "strong":
        return this.inlines(node.children, { ...style, bold: true }, noMarks);
      case "emphasis":
        return this.inlines(node.children, { ...style, italics: true }, noMarks);
      case "delete":
        return this.inlines(node.children, { ...style, strike: true }, noMarks);
      case "inlineCode":
        return this.around(node, noMarks, () => [this.run(node.value, { ...style, code: true })]);
      case "break":
        return [new TextRun({ text: "", break: 1 })];
      case "link": {
        if (!EXTERNAL.test(node.url)) return this.inlines(node.children, { ...style, link: true }, noMarks);
        return this.around(node, noMarks, () => [
          new ExternalHyperlink({
            link: node.url,
            children: this.inlines(node.children, { ...style, link: true }, true),
          }),
        ]);
      }
      case "linkReference":
        return this.inlines(node.children, style, noMarks);
      case "image":
        return this.around(node, noMarks, () => this.image(node.url, node.alt ?? "", style));
      case "imageReference":
        return [this.run(node.alt ?? "", style)];
      case "footnoteReference":
        return [new FootnoteReferenceRun(this.footnote(node.identifier))];
      case "inlineMath": {
        const math = wordMath(node.value, false);
        return this.around(node, noMarks, () => (math ? [math] : [this.run(node.value, { ...style, code: true })]));
      }
      case "html":
        return this.html(node.value, style);
      default:
        return "children" in node ? this.inlines(node.children as PhrasingContent[], style, noMarks) : [];
    }
  }

  /** Inline HTML: line breaks, sub- and superscripts; other tags are dropped, their text kept. */
  private html(value: string, style: Inline): ParagraphChild[] {
    if (/^<br\s*\/?>$/i.test(value.trim())) return [new TextRun({ text: "", break: 1 })];
    if (/^<\/?(sub|sup|kbd|span|u|mark|small|abbr)\b/i.test(value.trim())) return [];
    const text = new DOMParser().parseFromString(value, "text/html").body.textContent ?? "";
    return text ? [this.run(text, style)] : [];
  }

  private image(url: string, alt: string, style: Inline): ParagraphChild[] {
    const picture = this.pictures.get(url);
    if (!picture) {
      const label = alt || "Image";
      return EXTERNAL.test(url)
        ? [new ExternalHyperlink({ link: url, children: [this.run(label, { ...style, link: true })] })]
        : [this.run(`[${label}]`, { ...style, italics: true })];
    }
    return [
      new ImageRun({
        type: picture.type,
        data: picture.data,
        transformation: fit(picture),
        altText: { name: alt || "Image", description: alt, title: alt },
      }),
    ];
  }

  private footnote(identifier: string): number {
    let n = this.footnoteNumbers.get(identifier);
    if (n === undefined) {
      n = this.footnoteNumbers.size + 1;
      this.footnoteNumbers.set(identifier, n);
      const definition = this.footnoteDefinitions.get(identifier);
      const children = definition
        ? this.blocks(definition.children, { indent: 0, noMarks: true }).filter(
            (b): b is Paragraph => b instanceof Paragraph,
          )
        : [];
      this.footnotes[n] = { children: children.length ? children : [new Paragraph("")] };
    }
    return n;
  }

  /* ----- blocks ----- */

  private paragraph(children: ParagraphChild[], block: Block, options: IParagraphOptions = {}): Paragraph {
    const lead = block.lead ? [new TextRun({ text: block.lead, bold: block.bold })] : [];
    return new Paragraph({
      ...options,
      children: [...lead, ...children],
      numbering: block.numbering,
      indent: block.indent && !block.numbering ? { left: block.indent } : options.indent,
      border: block.bar
        ? { left: { style: BorderStyle.SINGLE, size: 18, color: block.bar, space: 10 }, ...options.border }
        : options.border,
    });
  }

  blocks(nodes: (RootContent | BlockContent | DefinitionContent)[], block: Block): Output {
    const out: Output = [];
    let first = true;
    for (const node of nodes) {
      // A list item's numbering and box only go to its first paragraph.
      const own = first ? block : { ...block, numbering: undefined, lead: undefined, indent: block.indent };
      if (!first && block.numbering) own.indent = INDENT * (block.numbering.level + 1);
      out.push(...this.block(node, own));
      if (node.type !== "footnoteDefinition" && node.type !== "definition") first = false;
    }
    return out;
  }

  private block(node: RootContent | BlockContent | DefinitionContent, block: Block): Output {
    switch (node.type) {
      case "heading": {
        const levels = [
          HeadingLevel.HEADING_1,
          HeadingLevel.HEADING_2,
          HeadingLevel.HEADING_3,
          HeadingLevel.HEADING_4,
          HeadingLevel.HEADING_5,
          HeadingLevel.HEADING_6,
        ];
        return [
          this.paragraph(this.inlines(node.children, {}, !!block.noMarks), block, { heading: levels[node.depth - 1] }),
        ];
      }
      case "paragraph": {
        const onlyImage = node.children.length === 1 && node.children[0].type === "image";
        return [
          this.paragraph(this.inlines(node.children, { bold: block.bold }, !!block.noMarks), block, {
            alignment: onlyImage && !block.numbering && !block.indent ? AlignmentType.CENTER : undefined,
          }),
        ];
      }
      case "blockquote":
        return this.quote(node, block);
      case "list":
        return this.list(node, block);
      case "code":
        return this.code(node, block);
      case "math": {
        const math = wordMath(node.value, true);
        const children = this.wrapped(node.position?.start.offset, node.position?.end.offset, !!block.noMarks, [
          math ?? this.run(node.value, { code: true }),
        ]);
        return [
          this.paragraph(children, block, { alignment: AlignmentType.CENTER, spacing: { before: 120, after: 120 } }),
        ];
      }
      case "table":
        return [this.table(node, block)];
      case "thematicBreak":
        return [
          this.paragraph([], block, {
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: this.color("--border", "D9D9D9"), space: 1 },
            },
            spacing: { after: 240 },
          }),
        ];
      case "html": {
        const text = new DOMParser().parseFromString(node.value, "text/html").body.textContent?.trim();
        return text ? [this.paragraph([this.run(text, {})], block)] : [];
      }
      case "yaml":
        return this.frontmatter(block);
      case "footnoteDefinition":
      case "definition":
        return [];
      default:
        // TOML frontmatter isn't in mdast's types.
        if ((node.type as string) === "toml") return this.frontmatter(block);
        return "children" in node ? this.blocks(node.children as BlockContent[], block) : [];
    }
  }

  private quote(node: Extract<RootContent, { type: "blockquote" }>, block: Block): Output {
    const classes = (node.data as { hProperties?: { className?: string[] } } | undefined)?.hProperties?.className ?? [];
    const alert = classes.find((c) => c.startsWith("alert-"));
    const bar = alert ? this.color(`--${alert}`, ALERT_COLORS[alert] ?? "2F6FB3") : this.color("--warm", "D98A3D");
    const inner: Block = { ...block, indent: block.indent + INDENT / 2, bar, numbering: undefined, lead: undefined };
    const out: Output = [];
    node.children.forEach((child, i) => {
      // An alert's title, in its colour.
      if (alert && i === 0 && child.type === "paragraph") {
        out.push(this.paragraph(this.inlines(child.children, { bold: true }, true), inner, {}));
        return;
      }
      out.push(...this.block(child, inner));
    });
    return out;
  }

  private list(node: List, block: Block): Output {
    const level = block.numbering
      ? Math.min(block.numbering.level + 1, LIST_LEVELS - 1)
      : Math.min(Math.round(block.indent / INDENT), LIST_LEVELS - 1);
    let reference = "bullets";
    let instance = 0;
    if (node.ordered) {
      const start = node.start ?? 1;
      reference = `ordered-${start}`;
      if (!this.orderedLists.some((l) => l.reference === reference)) this.orderedLists.push({ reference, start });
      // Each list counts from its start.
      instance = ++this.listInstance;
    }
    return node.children.flatMap((item: ListItem) => {
      const task = item.checked === true || item.checked === false;
      const itemBlock: Block = {
        ...block,
        numbering: task ? undefined : { reference, level, instance },
        indent: task ? INDENT * (level + 1) : block.indent,
        lead: task ? (item.checked ? "☑ " : "☐ ") : undefined,
      };
      const content = item.children.length ? item.children : [{ type: "paragraph", children: [] } as BlockContent];
      return this.blocks(content, itemBlock);
    });
  }

  private code(node: Code, block: Block): Output {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    const picture = node.lang === "mermaid" ? this.diagrams.get(node.value) : null;
    if (picture) {
      const image = new ImageRun({
        type: "png",
        data: picture.data,
        transformation: fit(picture),
        altText: { name: "Diagram", description: "Mermaid diagram", title: "Diagram" },
      });
      return [
        this.paragraph(this.wrapped(from, to, !!block.noMarks, [image]), block, { alignment: AlignmentType.CENTER }),
      ];
    }
    // Comments on code take the whole block: they start on its first line and end on its last.
    const pre =
      block.noMarks || from === undefined || to === undefined ? [] : [...this.before(from), ...this.startsInside(to)];
    const post = block.noMarks || to === undefined ? [] : this.after(to);
    const fill = this.color("--code-bg", "F4F1EA");
    const text = this.color("--text", "25221D");
    const lines =
      (node.lang && codeTokens(node.value, node.lang)) ||
      node.value.split("\n").map((content) => [{ content, bold: false, italic: false }]);
    const border = { style: BorderStyle.SINGLE, size: 4, color: fill, space: 6 };
    return lines.map((tokens, i) =>
      this.paragraph(
        [
          ...(i === 0 ? pre : []),
          ...(tokens.length
            ? tokens.map(
                (t) =>
                  new TextRun({
                    text: t.content,
                    font: CODE_FONT,
                    size: 19,
                    color: hexColor((t as { color?: string }).color, this.o.variables) ?? text,
                    bold: t.bold || undefined,
                    italics: t.italic || undefined,
                  }),
              )
            : [new TextRun({ text: "", font: CODE_FONT, size: 19 })]),
          ...(i === lines.length - 1 ? post : []),
        ],
        { ...block, numbering: undefined, lead: undefined },
        {
          shading: { type: ShadingType.CLEAR, fill, color: "auto" },
          spacing: { before: i === 0 ? 120 : 0, after: i === lines.length - 1 ? 200 : 0, line: 260 },
          // Lines touch, so the block reads as one box.
          border: {
            top: i === 0 ? border : undefined,
            bottom: i === lines.length - 1 ? border : undefined,
            left: border,
            right: border,
          },
        },
      ),
    );
  }

  private table(node: MdTable, block: Block): Table {
    const align = node.align ?? [];
    const alignment = (i: number) =>
      align[i] === "center" ? AlignmentType.CENTER : align[i] === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT;
    const columns = Math.max(1, ...node.children.map((row) => row.children.length));
    const border = { style: BorderStyle.SINGLE, size: 4, color: this.color("--border", "D9D9D9") };
    const headerFill = this.color("--code-bg", "F2F2F2");
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      indent: block.indent ? { size: block.indent, type: WidthType.DXA } : undefined,
      borders: {
        top: border,
        bottom: border,
        left: border,
        right: border,
        insideHorizontal: border,
        insideVertical: border,
      },
      rows: node.children.map(
        (row, r) =>
          new TableRow({
            tableHeader: r === 0,
            children: Array.from({ length: columns }, (_, c) => {
              const cell = row.children[c];
              return new TableCell({
                shading: r === 0 ? { type: ShadingType.CLEAR, fill: headerFill, color: "auto" } : undefined,
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                children: [
                  new Paragraph({
                    alignment: alignment(c),
                    children: cell ? this.inlines(cell.children, { bold: r === 0 }, !!block.noMarks) : [],
                  }),
                ],
              });
            }),
          }),
      ),
    });
  }

  private frontmatter(block: Block): Output {
    if (!this.o.showFrontmatter) return [];
    const entries = parseFrontmatter(this.o.source);
    if (!entries) return [];
    const muted = this.color("--text-muted", "6D685F");
    const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const line = { style: BorderStyle.SINGLE, size: 4, color: this.color("--border", "D9D9D9") };
    return [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: line, bottom: line, left: none, right: none, insideHorizontal: none, insideVertical: none },
        rows: entries.map(
          ({ key, value }) =>
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 25, type: WidthType.PERCENTAGE },
                  children: [new Paragraph({ children: [new TextRun({ text: key, color: muted, size: 19 })] })],
                }),
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: value || "—", size: 19 })] })],
                }),
              ],
            }),
        ),
      }),
      this.paragraph([], block),
    ];
  }

  /** Footnotes are collected first, so references can number them in order of use. */
  collectFootnotes(tree: Root) {
    visit(tree, "footnoteDefinition", (node: FootnoteDefinition) => {
      this.footnoteDefinitions.set(node.identifier, node);
    });
  }

  numbering(): INumberingOptions {
    const level = (i: number, format: (typeof LevelFormat)[keyof typeof LevelFormat], text: string, start = 1) => ({
      level: i,
      format,
      text,
      start,
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: INDENT * (i + 1), hanging: 360 } } },
    });
    const orderedFormats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
    return {
      config: [
        {
          reference: "bullets",
          levels: Array.from({ length: LIST_LEVELS }, (_, i) =>
            level(i, LevelFormat.BULLET, BULLETS[i % BULLETS.length]),
          ),
        },
        ...this.orderedLists.map(({ reference, start }) => ({
          reference,
          levels: Array.from({ length: LIST_LEVELS }, (_, i) =>
            level(i, orderedFormats[i % 3], `%${i + 1}.`, i === 0 ? start : 1),
          ),
        })),
      ],
    };
  }
}

/** Fetches the document's images and draws its diagrams ahead of the conversion, which can't wait. */
async function prepareMedia(tree: Root, o: WordOptions) {
  const baseDir = dirname(o.filePath);
  const toLocal = (src: string) => (src.startsWith("/") ? resolve(o.root, src.slice(1)) : resolve(baseDir, src));
  const pictures = new Map<string, Picture | null>();
  const diagrams = new Map<string, Picture | null>();
  const jobs: Promise<void>[] = [];
  visit(tree, (node) => {
    if (node.type === "image") {
      const url = (node as { url: string }).url;
      if (!url || pictures.has(url)) return;
      pictures.set(url, null);
      if (EXTERNAL.test(url) && blocksImage(o.remoteImages ?? "all", url)) return;
      const source = EXTERNAL.test(url) ? url : o.assetUrl(toLocal(decodeLink(url)));
      jobs.push(
        fetchPicture(source).then(
          (picture) => void pictures.set(url, picture),
          // Missing, unreadable or not allowed to load: shown as its alt text.
          () => {},
        ),
      );
    } else if (node.type === "code" && (node as Code).lang === "mermaid") {
      const code = (node as Code).value;
      if (diagrams.has(code)) return;
      diagrams.set(code, null);
      jobs.push(
        diagramPicture(code, o.mermaid).then(
          (picture) => void diagrams.set(code, picture),
          () => {},
        ),
      );
    }
  });
  await Promise.all(jobs);
  return { pictures, diagrams };
}

/** Builds the Word document for `o.source`. */
export async function wordDocument(o: WordOptions): Promise<Blob> {
  if (o.showFrontmatter && hasFrontmatter(o.source)) await loadFrontmatterParsers();
  await loadLanguages(codeLanguages(o.source));
  const processor = unified().use(remarkParse);
  for (const plugin of remarkPlugins) {
    if (Array.isArray(plugin)) processor.use(plugin[0] as never, ...(plugin.slice(1) as never[]));
    else processor.use(plugin as never);
  }
  const tree = processor.runSync(processor.parse(o.source)) as Root;
  const media = await prepareMedia(tree, o);

  const { comments, marks } = commentMarks(o.threads);
  const converter = new WordConverter(o, marks, media.pictures, media.diagrams);
  converter.collectFootnotes(tree);
  const children = converter.blocks(tree.children, { indent: 0 });
  const leftover = converter.remainingMarks();
  if (leftover.length) children.push(new Paragraph({ children: leftover }));

  const heading = hexColor(o.variables["--md-heading"], {}) ?? hexColor(o.variables["--text"], {}) ?? "1D1B17";
  const letter = /^en-(US|CA)|^es-(MX|US)|^fr-CA/.test(navigator.language);
  const doc = new Document({
    title: o.title,
    creator: "Mido",
    description: "Exported from Mido",
    comments: { children: comments },
    footnotes: converter.footnotes,
    numbering: converter.numbering(),
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22, color: hexColor(o.variables["--text"], {}) ?? "25221D" },
          paragraph: { spacing: { after: 140, line: 288 } },
        },
        heading1: {
          run: { size: 40, bold: true, color: heading },
          paragraph: { spacing: { before: 360, after: 160 } },
        },
        heading2: {
          run: { size: 32, bold: true, color: heading },
          paragraph: { spacing: { before: 320, after: 140 } },
        },
        heading3: {
          run: { size: 27, bold: true, color: heading },
          paragraph: { spacing: { before: 280, after: 120 } },
        },
        heading4: {
          run: { size: 24, bold: true, color: heading },
          paragraph: { spacing: { before: 240, after: 100 } },
        },
        heading5: { run: { size: 22, bold: true, color: heading }, paragraph: { spacing: { before: 200, after: 80 } } },
        heading6: {
          run: { size: 22, bold: true, italics: true, color: heading },
          paragraph: { spacing: { before: 200, after: 80 } },
        },
        hyperlink: { run: { color: hexColor(o.variables["--accent"], {}) ?? "2D6A5F", underline: {} } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: letter ? { width: 12240, height: 15840 } : { width: 11906, height: 16838 },
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        children: children.length ? children : [new Paragraph("")],
      },
    ],
  });
  const blob = await Packer.toBlob(doc);
  return addResolvedState(blob, comments);
}

/**
 * Word keeps whether a thread is resolved in commentsExtended.xml, which the
 * docx library only writes for threads with replies: adds it for documents
 * whose resolved threads have none.
 */
async function addResolvedState(blob: Blob, comments: ICommentOptions[]): Promise<Blob> {
  if (!comments.some((c) => c.resolved) || comments.some((c) => c.parentId !== undefined)) return blob;
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const entries = comments
    .map((c) => `<w15:commentEx w15:paraId="${commentIdToParaId(c.id)}" w15:done="${c.resolved ? 1 : 0}"/>`)
    .join("");
  zip.file(
    "word/commentsExtended.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w15:commentsEx xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w15">${entries}</w15:commentsEx>`,
  );
  const types = await zip.file("[Content_Types].xml")!.async("string");
  zip.file(
    "[Content_Types].xml",
    types.replace(
      "</Types>",
      '<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/></Types>',
    ),
  );
  const relsPath = "word/_rels/document.xml.rels";
  const rels = await zip.file(relsPath)!.async("string");
  zip.file(
    relsPath,
    rels.replace(
      "</Relationships>",
      '<Relationship Id="rIdMidoCommentsEx" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/></Relationships>',
    ),
  );
  return zip.generateAsync({ type: "blob", mimeType: blob.type });
}
