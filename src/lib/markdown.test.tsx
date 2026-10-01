import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { documentStats, parseFrontmatter, rehypePlugins, remarkPlugins } from "./markdown";

/** Renders Markdown through the preview's real pipeline. */
const render = (src: string) =>
  renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={remarkPlugins as never} rehypePlugins={rehypePlugins as never}>
      {src}
    </ReactMarkdown>,
  );

describe("sanitizer", () => {
  it("removes scripts and event handlers from raw HTML", () => {
    const html = render('<script>alert(1)</script>\n\n<img src="x.png" onerror="alert(1)">\n\n<p onclick="x()">hi</p>');
    expect(html).not.toMatch(/<script|onerror|onclick|alert/);
    expect(html).toContain('src="x.png"');
  });

  it("removes javascript: links", () => {
    expect(render("[a](javascript:alert(1))")).not.toContain("javascript:");
    expect(render('<a href="javascript:alert(1)">a</a>')).not.toContain("javascript:");
  });

  it("removes iframes, objects, forms and inline styles", () => {
    const html = render(
      '<iframe src="https://x"></iframe><object data="x"></object><form action="https://x"><input></form><p style="position:fixed">s</p>',
    );
    expect(html).not.toMatch(/<iframe|<object|<form|style=/);
  });

  it("prefixes ids and names from raw HTML, so they can't clobber globals", () => {
    const html = render('<img id="__TAURI__" name="x"> <a name="top"></a>\n\n<a href="#t" aria-describedby="n">t</a>');
    expect(html).toContain('id="user-content-__TAURI__"');
    expect(html).toContain('name="user-content-x"');
    expect(html).toContain('name="user-content-top"');
    expect(html).toContain('aria-describedby="user-content-n"');
  });

  it("keeps footnote links pointing at their targets, and heading ids as slugs", () => {
    const html = render("# Title\n\na[^1]\n\n[^1]: n");
    expect(html).toContain('id="title"');
    expect(html).toContain('href="#user-content-fn-1"');
    expect(html).toContain('id="user-content-fn-1"');
    expect(html).toMatch(/aria-describedby="([^"]+)"[\s\S]*id="\1"/);
  });

  it("keeps the attributes the preview relies on", () => {
    const html = render('# Title\n\n<img src="a.png" width="40" height="20">\n\n<p align="center">c</p>');
    expect(html).toContain('data-line="1"');
    expect(html).toContain('id="title"');
    expect(html).toMatch(/width="40"/);
    expect(html).toMatch(/align="center"/);
  });

  it("tags blocks inside top-level ones with their offset from its line", () => {
    const html = render("- a\n- b\n\n  more\n\n| x |\n| - |\n| 1 |");
    expect(html).toContain('<ul data-line="1">');
    expect(html).not.toMatch(/<li data-line-offset="0"/);
    expect(html).toContain('<li data-line-offset="1">');
    expect(html).toContain('<p data-line-offset="3">more</p>');
    expect(html).toContain('<tr data-line-offset="2">');
  });

  it("tags raw HTML blocks with their source line, and only with that", () => {
    const html = render('<div align="center">\n\n<img src="a.png">\n\n</div>\n\n<p data-line="99">x</p>');
    expect(html).toContain('<div align="center" data-line="1">');
    expect(html).toContain('<p data-line="7">');
    expect(html).not.toContain("99");
  });
});

describe("rendering", () => {
  it("renders GitHub-style alerts", () => {
    const html = render("> [!WARNING]\n> Careful");
    expect(html).toContain('class="alert alert-warning"');
    expect(html).toContain('<p class="alert-title">Warning</p>');
    expect(html).toContain("Careful");
    expect(html).not.toContain("[!WARNING]");
  });

  it("leaves ordinary blockquotes alone", () => {
    expect(render("> [!NOTANALERT] text")).not.toContain("alert");
  });

  it("renders GFM tables, task lists, strikethrough and footnotes", () => {
    const html = render("| a |\n| - |\n| 1 |\n\n- [x] done\n\n~~old~~ note[^1]\n\n[^1]: The note.");
    expect(html).toMatch(/<table[ >]/);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(html).toContain("<del>old</del>");
    expect(html).toContain('href="#user-content-fn-1"');
    expect(html).toContain('id="user-content-fn-1"');
  });

  it("renders math with KaTeX", () => {
    expect(render("$$E = mc^2$$")).toContain('class="katex');
  });

  it("highlights code with a declared language only", () => {
    expect(render("```js\nconst x = 1;\n```")).toContain("hljs-keyword");
    expect(render("```\nconst x = 1;\n```")).not.toContain("hljs-keyword");
  });

  it("doesn't render frontmatter as text", () => {
    const html = render("---\ntitle: Hidden\n---\n\nBody");
    expect(html).not.toContain("Hidden");
    expect(html).toContain("Body");
  });
});

describe("parseFrontmatter", () => {
  it("reads key/value pairs, unquoting values", () => {
    expect(parseFrontmatter('---\ntitle: "Hello"\nauthor: \'Me\'\ndraft: true\n---\nBody')).toEqual([
      { key: "title", value: "Hello" },
      { key: "author", value: "Me" },
      { key: "draft", value: "true" },
    ]);
  });

  it("joins inline and block lists", () => {
    expect(parseFrontmatter("---\ntags: [a, 'b']\nauthors:\n  - Ann\n  - Bob\n---\n")).toEqual([
      { key: "tags", value: "a, b" },
      { key: "authors", value: "Ann, Bob" },
    ]);
  });

  it("handles Windows line endings", () => {
    expect(parseFrontmatter("---\r\ntitle: x\r\n---\r\n")).toEqual([{ key: "title", value: "x" }]);
  });

  it("returns null without frontmatter, or when it isn't at the very top", () => {
    expect(parseFrontmatter("# Title")).toBeNull();
    expect(parseFrontmatter("\n---\ntitle: x\n---\n")).toBeNull();
    expect(parseFrontmatter("---\n---\n")).toBeNull();
  });
});

describe("documentStats", () => {
  it("counts words in any script, with apostrophes and hyphens inside words", () => {
    expect(documentStats("Hello world").words).toBe(2);
    expect(documentStats("l'albero è well-known").words).toBe(3);
    expect(documentStats("日本 и русский").words).toBe(3);
    expect(documentStats("# — * 1").words).toBe(1);
  });

  it("counts lines and reading time", () => {
    expect(documentStats("")).toEqual({ words: 0, chars: 0, lines: 0, minutes: 1 });
    expect(documentStats("a\nb\n").lines).toBe(3);
    expect(documentStats("word ".repeat(660)).minutes).toBe(3);
  });
});
