// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { BlockRenderer, splitChunks } from "./blockRenderer";
import { rehypePlugins, remarkPlugins } from "./markdown";

/** HTML with each element's attributes in order, so attribute order doesn't count. */
function normalized(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const el of doc.body.querySelectorAll("*")) {
    const attrs = [...el.attributes].map((a) => [a.name, a.value]).sort(([a], [b]) => (a < b ? -1 : 1));
    for (const [name] of attrs) el.removeAttribute(name);
    for (const [name, value] of attrs) el.setAttribute(name, value);
  }
  return doc.body.innerHTML;
}

const reference = (src: string) =>
  normalized(
    renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={remarkPlugins as never} rehypePlugins={rehypePlugins as never}>
        {src}
      </ReactMarkdown>,
    ),
  );

const blocks = (renderer: BlockRenderer, src: string) => normalized(renderToStaticMarkup(<>{renderer.render(src)}</>));

const CASES: Record<string, string> = {
  empty: "",
  "no trailing newline": "# Title\n\npara",
  crlf: "# A\r\n\r\npara\r\n\r\n```js\r\nx\r\n\r\ny\r\n```\r\n\r\nafter",
  frontmatter: "---\ntitle: x\n---\n\n# A\n\n---\n\nnot: frontmatter\n\n---\n",
  toml: "+++\ntitle = 1\n+++\n\ntext",
  "unclosed frontmatter": "---\n\nA\n\nB",
  "fence with blank lines": "```\na\n\nb\n\n# not heading\n```\n\nafter",
  "unclosed fence": "a\n\n```\ncode\n\nmore [x]\n\n[x]: /u",
  "unclosed fence after a reference": "[x] a\n```\ncode\n\nmore\n\n[x]: /u",
  "fence inside an HTML block": "<div>\n```\n\nx [y]\n\n```\ncode\n\n[y]: /y\n\n```\n\nend",
  "unclosed math": "a\n\n$$\nx\n\ny",
  "tilde fence with backticks": "~~~\n```\n\nx\n~~~\n\ny",
  "math block with blank lines": "$$\na\n\nb\n$$\n\nafter $x$\n\n$$E = mc^2$$",
  "html comment with blank lines": "<!--\n\nhidden\n\n-->\n\nshown",
  "raw div around markdown": '<div align="center">\n\n**bold**\n\n</div>\n\npara',
  "nested raw divs": "<div>\n\n<div>\n\nx\n\n</div>\n\ny\n\n</div>\n\nz",
  "unclosed inline tag": "a <b>bold\n\nnext\n\nlast",
  "stray closing tag": "</div>\n\ntext",
  "tight and loose lists": "- a\n- b\n\n- c\n\npara\n\n1. one\n\n2. two\n\n10) x",
  "list continuation": "- item\n\n  more\n\n      code\n\nend",
  "indented code": "para\n\n    code\n\n    more\n\nend",
  blockquotes: "> a\n\n> b\n>\n> c\n\n> [!NOTE]\n> alert",
  "reference links across blocks": "See [x] and [y][Y] and ![i][img].\n\nmore\n\n[x]: /x\n\n> [Y]: /y\n\n- [img]: /i.png",
  "undefined reference": "[nope] and [^nope]",
  "definition in code block": "```\n[x]: /x\n```\n\n[x]\n\n[^f]\n\n```\n[^f]: no\n```",
  footnotes: "a[^1] b[^2] a again[^1]\n\n[^2]: two\n\n[^1]: one\n    with more\n\nend",
  "unicode labels": "[Straße] and [STRASSE]\n\n[strasse]: /s",
  "duplicate headings": "# Intro\n\n## Intro\n\ntext\n\n# Intro\n\n## $x$ math\n\n## `code` head",
  "raw heading with id": '<h2 id="custom">Custom</h2>\n\n## Custom',
  tables: "| a | b |\n|---|:-:|\n| 1 | 2 |\n\n| c |\n| - |\n| 3 |",
  "setext and breaks": "Title\n=====\n\nSub\n---\n\n***\n\n- - -",
  "task list": "- [x] done\n- [ ] todo",
  "unsafe urls": "[a](javascript:alert(1)) <a href=\"vbscript:x\">b</a>",
  "repeated identical blocks": "## Same\n\ntext\n\n## Same\n\ntext\n\n## Same\n\ntext",
};

describe("splitChunks", () => {
  it("rejoins to the source, starting each chunk at its line", () => {
    for (const src of Object.values(CASES)) {
      const chunks = splitChunks(src);
      expect(chunks.map((c) => c.text).join("")).toBe(src);
      for (const c of chunks) expect(src.slice(0, c.offset).split(/\r\n?|\n/).length).toBe(c.line);
    }
  });

  it("doesn't split inside fences, math or multi-line HTML", () => {
    expect(splitChunks("```\na\n\nb\n```\n\nc").map((c) => c.text)).toEqual(["```\na\n\nb\n```\n\n", "c"]);
    expect(splitChunks("$$\na\n\nb\n$$").length).toBe(1);
    expect(splitChunks("<!--\n\nx\n\n-->").length).toBe(1);
  });

  it("keeps list items and continuations with what they continue", () => {
    expect(splitChunks("- a\n\n- b\n\n  c\n\nd").map((c) => c.text)).toEqual(["- a\n\n- b\n\n  c\n\n", "d"]);
  });
});

describe("BlockRenderer", () => {
  for (const [name, src] of Object.entries(CASES)) {
    it(`renders like react-markdown: ${name}`, () => {
      expect(blocks(new BlockRenderer(), src)).toBe(reference(src));
    });
  }

  // Hundreds of whole-document renders, each also through react-markdown: longer than
  // Vitest's default 5 s timeout on CI runners.
  it("renders like react-markdown through a long run of random edits", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pieces = ["\n", "\n\n", " ", "  ", "#", "- ", "1. ", "`", "```", "$", "$$", "<div>", "</div>", "<b>", "[", "]", "[x]", "[^1]", ": /u", ">", "|", "---", "a", "word "];
    const renderer = new BlockRenderer();
    let src = Object.values(CASES).join("\n\n");
    for (let step = 0; step < 300; step++) {
      const at = Math.floor(random() * (src.length + 1));
      if (random() < 0.4 && src.length > 0) {
        src = src.slice(0, at) + src.slice(at + 1 + Math.floor(random() * 4));
      } else {
        src = src.slice(0, at) + pieces[Math.floor(random() * pieces.length)] + src.slice(at);
      }
      expect(blocks(renderer, src), `step ${step}`).toBe(reference(src));
    }
  }, 60_000);

  it("tags top-level blocks with their source line as the document changes", () => {
    const renderer = new BlockRenderer();
    expect(blocks(renderer, "# A\n\npara")).toContain('<p data-line="3">');
    expect(blocks(renderer, "\n\n# A\n\npara")).toContain('<p data-line="5">');
  });

  it("keeps nested offsets relative when a block moves", () => {
    const renderer = new BlockRenderer();
    expect(blocks(renderer, "- a\n- b")).toContain('<li data-line-offset="1">');
    const moved = blocks(renderer, "# T\n\n\n- a\n- b");
    expect(moved).toContain('<ul data-line="4">');
    expect(moved).toContain('<li data-line-offset="1">');
  });

  it("re-renders only the blocks that changed", () => {
    const renderer = new BlockRenderer();
    const before = renderer.render("# A\n\none\n\ntwo");
    const after = renderer.render("# A\n\none!\n\ntwo");
    const props = (nodes: typeof before) => nodes.filter((n) => typeof n === "object").map((n) => (n as { props: object }).props);
    const [h1, , p2] = props(before);
    const [h1b, p1b, p2b] = props(after);
    expect((h1b as { children: unknown }).children).toBe((h1 as { children: unknown }).children);
    expect((p2b as { children: unknown }).children).toBe((p2 as { children: unknown }).children);
    expect(p1b).toBeDefined();
  });
});
