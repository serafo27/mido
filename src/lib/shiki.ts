// Code highlighting with Shiki: the TextMate grammars VS Code uses, for
// every language it knows. Grammars load as documents use them; until one
// has loaded, its code shows plain, and the preview renders again once it
// has (see `subscribeHighlighting`). Shiki runs on its JavaScript regex
// engine: the app's content security policy has no room for WebAssembly.
import type { Element, ElementContent, Root } from "hast";
import type { HighlighterCore, ThemeRegistrationRaw } from "shiki/core";
import { bundledLanguages, bundledLanguagesInfo } from "shiki/langs";
import { toString } from "hast-util-to-string";
import { visit } from "unist-util-visit";

const color = (name: string) => `var(--hl-${name})`;

/**
 * Token colours from the app theme's highlight variables, so code follows
 * the theme (custom ones too), in the preview and in exported pages. Scopes
 * are grouped as in VS Code's default themes.
 */
const THEME: ThemeRegistrationRaw = {
  name: "mido",
  type: "light",
  fg: "var(--text)",
  bg: "transparent",
  settings: [
    { settings: { foreground: "var(--text)", background: "transparent" } },
    {
      scope: ["comment", "punctuation.definition.comment", "string.quoted.docstring"],
      settings: { foreground: color("comment"), fontStyle: "italic" },
    },
    {
      scope: ["string", "punctuation.definition.string", "markup.inline.raw", "markup.fenced_code.block", "markup.inserted"],
      settings: { foreground: color("string") },
    },
    {
      scope: [
        "constant.numeric",
        "constant.language",
        "constant.character",
        "constant.other",
        "variable.other.constant",
        "variable.other.enummember",
        "support.constant",
        "markup.list",
      ],
      settings: { foreground: color("number") },
    },
    {
      scope: [
        "keyword",
        "storage.type",
        "storage.modifier",
        "variable.language",
        "entity.name.tag",
        "keyword.operator.new",
        "keyword.operator.expression",
        "keyword.operator.word",
      ],
      settings: { foreground: color("keyword") },
    },
    // Operators and punctuation stay the text colour, as in VS Code.
    { scope: ["keyword.operator", "punctuation"], settings: { foreground: "var(--text)" } },
    {
      scope: ["entity.name.function", "support.function", "markup.heading", "entity.name.section"],
      settings: { foreground: color("title") },
    },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "entity.name.namespace",
        "entity.other.inherited-class",
        "support.type",
        "support.class",
      ],
      settings: { foreground: color("type") },
    },
    {
      scope: [
        "variable.other.property",
        "variable.other.object.property",
        "meta.object-literal.key",
        "support.type.property-name",
        "entity.other.attribute-name",
        "variable.other.readwrite.alias",
      ],
      settings: { foreground: color("attr") },
    },
    {
      scope: ["meta.preprocessor", "meta.decorator", "punctuation.definition.tag", "punctuation.decorator"],
      settings: { foreground: color("meta") },
    },
    { scope: "markup.deleted", settings: { foreground: "var(--alert-caution)" } },
    { scope: "markup.bold", settings: { fontStyle: "bold" } },
    { scope: "markup.italic", settings: { fontStyle: "italic" } },
    { scope: "markup.underline.link", settings: { foreground: "var(--accent)" } },
  ],
};

/** Language ids by name and alias, lowercase. */
const LANGUAGES = new Map<string, string>();
for (const { id, aliases } of bundledLanguagesInfo) {
  LANGUAGES.set(id, id);
  for (const alias of aliases ?? []) LANGUAGES.set(alias, id);
}

/** Shiki's id for a code block's language (`ts` → `typescript`), or null if it has no grammar for it. */
export function grammarFor(language: string): string | null {
  return LANGUAGES.get(language.toLowerCase()) ?? null;
}

let highlighter: HighlighterCore | null = null;
let creating: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();

let version = 0;
const listeners = new Set<() => void>();

/** Bumped each time a grammar loads: highlighting may then change. */
export const highlightingVersion = () => version;

/** Calls `listener` whenever a grammar has loaded; returns how to stop. */
export function subscribeHighlighting(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function createHighlighter(): Promise<HighlighterCore> {
  creating ??= Promise.all([import("shiki/core"), import("shiki/engine/javascript")]).then(
    async ([core, engine]) => {
      highlighter = await core.createHighlighterCore({
        themes: [THEME],
        langs: [],
        engine: engine.createJavaScriptRegexEngine(),
      });
      return highlighter;
    },
  );
  return creating;
}

/** Loads the grammars for `languages` (names or aliases); unknown ones are skipped. */
export function loadLanguages(languages: Iterable<string>): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const name of languages) {
    const id = grammarFor(name);
    if (!id || loaded.has(id)) continue;
    let job = loading.get(id);
    if (!job) {
      job = createHighlighter()
        .then(async (h) => {
          await h.loadLanguage(...(await bundledLanguages[id as keyof typeof bundledLanguages]()).default);
          loaded.add(id);
          version++;
          for (const listener of listeners) listener();
        })
        .catch((e) => {
          // Left plain, as an unknown language would be.
          console.error(`Couldn't load the ${id} grammar`, e);
        });
      loading.set(id, job);
    }
    jobs.push(job);
  }
  return Promise.all(jobs).then(() => {});
}

export interface CodeToken {
  content: string;
  /** A theme colour, as the CSS variable it comes from (`var(--hl-keyword)`). */
  color?: string;
  bold: boolean;
  italic: boolean;
}

/**
 * The highlighted tokens of `code`, line by line, for exports that aren't
 * HTML; null when its language has no grammar or it hasn't loaded.
 */
export function codeTokens(code: string, language: string): CodeToken[][] | null {
  const id = grammarFor(language);
  if (!id || !highlighter || !loaded.has(id)) return null;
  try {
    return highlighter.codeToTokensBase(code, { lang: id, theme: "mido" }).map((line) =>
      line.map((token) => ({
        content: token.content,
        color: token.color,
        italic: ((token.fontStyle ?? 0) & 1) !== 0,
        bold: ((token.fontStyle ?? 0) & 2) !== 0,
      })),
    );
  } catch {
    return null;
  }
}

/** The languages of a document's fenced code blocks, to load before rendering it at once (exports). */
export function codeLanguages(source: string): Set<string> {
  const names = new Set<string>();
  for (const [, name] of source.matchAll(/^[ \t>]*(?:`{3,}|~{3,})[ \t]*([^\s`{]+)/gm)) names.add(name);
  return names;
}

/** A token in the text colour, as its text: only coloured tokens need a span. */
const plain = (token: ElementContent): ElementContent[] =>
  token.type === "element" && token.properties.style === "color:var(--text)" ? token.children : [token];

const languageOf = (code: Element): string | undefined => {
  const classes = code.properties.className;
  if (!Array.isArray(classes)) return undefined;
  return classes.map(String).find((c) => c.startsWith("language-"))?.slice("language-".length);
};

/**
 * Highlights `<pre><code class="language-…">` blocks whose grammar has
 * loaded, and starts loading the ones that haven't. The `pre` and `code`
 * elements stay as they are; only the text inside gets coloured spans.
 */
export function rehypeShiki() {
  return (tree: Root) => {
    visit(tree, "element", (pre: Element) => {
      if (pre.tagName !== "pre") return;
      const code = pre.children[0];
      if (code?.type !== "element" || code.tagName !== "code") return;
      const language = languageOf(code);
      if (!language || language === "mermaid") return;
      const id = grammarFor(language);
      if (!id) return;
      if (!highlighter || !loaded.has(id)) {
        void loadLanguages([id]);
        return;
      }
      const text = toString(code);
      // Shiki ends at the last line; the code's own final newline is put back after.
      const final = text.endsWith("\n");
      try {
        const result = highlighter.codeToHast(final ? text.slice(0, -1) : text, { lang: id, theme: "mido" });
        const highlighted = ((result.children[0] as Element).children[0] as Element).children as ElementContent[];
        for (const line of highlighted) if (line.type === "element") line.children = line.children.flatMap(plain);
        code.children = final ? [...highlighted, { type: "text", value: "\n" }] : highlighted;
      } catch (e) {
        // A grammar the JavaScript engine can't run: leave the block plain.
        console.error(`Couldn't highlight ${id}`, e);
      }
    });
  };
}
