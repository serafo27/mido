import type { Element, ElementContent, Root as HastRoot } from "hast";
import type { Root as MdastRoot, Blockquote, Paragraph } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { visit } from "unist-util-visit";

/**
 * GitHub-style alerts: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`,
 * `> [!WARNING]`, `> [!CAUTION]`.
 */
export function remarkAlerts() {
  return (tree: MdastRoot) => {
    visit(tree, "blockquote", (node: Blockquote) => {
      const first = node.children[0];
      if (first?.type !== "paragraph") return;
      const text = first.children[0];
      if (text?.type !== "text") return;
      const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(\r?\n)?/i.exec(text.value);
      if (!match) return;

      const kind = match[1].toLowerCase();
      text.value = text.value.slice(match[0].length);
      if (!text.value) first.children.shift();
      if (first.children.length === 0) node.children.shift();

      node.data = { ...node.data, hProperties: { className: ["alert", `alert-${kind}`] } };
      const title: Paragraph = {
        type: "paragraph",
        children: [{ type: "text", value: kind[0].toUpperCase() + kind.slice(1) }],
        data: { hProperties: { className: ["alert-title"] } },
      };
      node.children.unshift(title);
    });
  };
}

/** Tags top-level blocks with their source line, used for editor→preview scroll sync. */
export function rehypeSourceLines() {
  return (tree: HastRoot) => {
    for (const node of tree.children) {
      if (node.type === "element" && node.position) {
        node.properties = { ...node.properties, dataLine: node.position.start.line };
      }
    }
  };
}

export const CLOBBER_PREFIX = "user-content-";

/**
 * Prefixes the ids and names a document sets (and the references to them),
 * so raw HTML like `<img id="__TAURI__">` can't shadow globals of the page
 * (DOM clobbering). Ones already prefixed, like footnotes', are kept; heading
 * slugs are added later, unprefixed, as links to them expect.
 */
export function rehypeClobberPrefix() {
  const prefix = (v: unknown) => (String(v).startsWith(CLOBBER_PREFIX) ? String(v) : CLOBBER_PREFIX + v);
  return (tree: HastRoot) => {
    visit(tree, "element", (node: Element) => {
      const p = node.properties;
      for (const key of ["id", "name"]) {
        if (p[key] != null && p[key] !== "") p[key] = prefix(p[key]);
      }
      for (const key of ["ariaDescribedBy", "ariaLabelledBy"]) {
        if (Array.isArray(p[key])) p[key] = p[key].map(prefix);
      }
    });
  };
}

const attrs = defaultSchema.attributes ?? {};

/** Sanitize raw HTML while keeping what our own plugins produce. */
export const sanitizeSchema = {
  ...defaultSchema,
  // rehypeClobberPrefix has prefixed ids already, skipping the ones that were.
  clobberPrefix: "",
  attributes: {
    ...attrs,
    "*": [...(attrs["*"] ?? []), "align"],
    code: [["className", /^language-./, "math-inline", "math-display"]],
    blockquote: [["className", /^alert/]],
    p: [...(attrs.p ?? []), ["className", "alert-title"]],
    img: [...(attrs.img ?? []), "width", "height"],
  },
};

/** The preview's rendering pipeline. */
export const remarkPlugins = [remarkGfm, remarkMath, [remarkFrontmatter, ["yaml", "toml"]], remarkAlerts];
/** The same, for Markdown that can't start with frontmatter (a part of a document after its start). */
export const remarkPluginsAfterStart = remarkPlugins.filter((p) => !Array.isArray(p) || p[0] !== remarkFrontmatter);
/** Steps before and after heading ids, which the preview's block renderer gives across blocks. */
export const rehypeBeforeSlug = [rehypeRaw, rehypeClobberPrefix, [rehypeSanitize, sanitizeSchema]];
export const rehypeAfterSlug = [rehypeKatex, [rehypeHighlight, { detect: false }]];
export const rehypePlugins = [
  ...rehypeBeforeSlug,
  // After raw HTML is parsed, so its blocks get a line too; after sanitizing,
  // so a document can't set lines of its own.
  rehypeSourceLines,
  rehypeSlug,
  ...rehypeAfterSlug,
];

export interface FrontmatterEntry {
  key: string;
  value: string;
}

/** Best-effort parse of simple `key: value` YAML frontmatter for display. */
export function parseFrontmatter(src: string): FrontmatterEntry[] | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(src);
  if (!match) return null;

  const entries: FrontmatterEntry[] = [];
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_][\w -]*):\s*(.*)$/.exec(line);
    if (kv) {
      entries.push({ key: kv[1].trim(), value: unquote(kv[2].trim()) });
      continue;
    }
    const item = /^\s+-\s+(.*)$/.exec(line);
    const last = entries[entries.length - 1];
    if (item && last) {
      last.value = last.value ? `${last.value}, ${unquote(item[1].trim())}` : unquote(item[1].trim());
    }
  }
  return entries.length ? entries : null;
}

function unquote(v: string): string {
  if (/^\[.*\]$/.test(v)) {
    return v.slice(1, -1).split(",").map((s) => unquote(s.trim())).join(", ");
  }
  return v.replace(/^(['"])(.*)\1$/, "$2");
}

export function documentStats(text: string) {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
  return {
    words,
    chars: text.length,
    lines: text === "" ? 0 : text.split("\n").length,
    minutes: Math.max(1, Math.round(words / 220)),
  };
}

/** The language of a `<pre><code class="language-…">` block. */
export function languageOf(node: Element | undefined): string | undefined {
  const code = node?.children[0];
  if (code?.type !== "element") return undefined;
  const classes = code.properties.className;
  if (!Array.isArray(classes)) return undefined;
  const lang = classes.map(String).find((c) => c.startsWith("language-"));
  return lang?.slice("language-".length);
}

/** The text content of a hast node. */
export function textOf(node: Element | ElementContent | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}
