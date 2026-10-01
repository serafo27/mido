// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentMarkdownVariables, htmlDocument, renderDocument, type RenderOptions } from "./exportDocument";

const render = (source: string, options: Partial<RenderOptions> = {}) =>
  renderDocument({
    source,
    filePath: "/notes/sub/doc.md",
    root: "/notes",
    showFrontmatter: false,
    mermaid: { dark: false, variables: {} },
    assetUrl: (path) => `asset://localhost${path}`,
    embedImages: false,
    ...options,
  });

afterEach(() => vi.unstubAllGlobals());

describe("renderDocument", () => {
  it("renders like the preview: code blocks with their language, wrapped tables", async () => {
    const html = await render("```js\nconst x = 1;\n```\n\n| a |\n| - |\n| 1 |");
    expect(html).toContain('<div class="code-block has-lang"><div class="code-meta"><span class="code-lang">js</span>');
    expect(html).toContain("hljs-keyword");
    expect(html).toMatch(/<div class="table-wrap"><table>/);
  });

  it("drops the preview's source-line attributes", async () => {
    expect(await render("# Title\n\ntext\n\n- a\n- b")).not.toContain("data-line");
  });

  it("keeps sanitizing raw HTML", async () => {
    const html = await render('<script>alert(1)</script>\n\n<img src="https://x/y.png" onerror="alert(1)">');
    expect(html).not.toMatch(/<script|onerror|alert/);
  });

  it("shows the frontmatter card only when asked", async () => {
    const src = "---\ntitle: Hello\n---\n\nBody";
    expect(await render(src)).not.toContain("frontmatter");
    expect(await render(src, { showFrontmatter: true })).toContain("<dt>title</dt><dd>Hello</dd>");
  });

  it("points local images at the asset protocol when not embedding", async () => {
    const html = await render("![a](../img/a.png) ![b](/top.png) ![c](https://example.com/c.png)");
    expect(html).toContain('src="asset://localhost/notes/img/a.png"');
    expect(html).toContain('src="asset://localhost/notes/top.png"');
    expect(html).toContain('src="https://example.com/c.png"');
    expect(html).not.toContain("data-local-path");
  });

  it("resolves a raw HTML image whose path has a bare %", async () => {
    expect(await render('<img src="100%.png">')).toContain('src="asset://localhost/notes/sub/100%.png"');
  });

  it("embeds local images as data URIs, keeping the original link when one can't be read", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("/a.png")
        ? new Response(new Blob(["PNG"], { type: "image/png" }))
        : new Response("missing", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetch);
    const html = await render("![a](a.png) ![b](b.png) ![c](https://example.com/c.png)", { embedImages: true });
    expect(html).toContain(`src="data:image/png;base64,${btoa("PNG")}"`);
    expect(html).toContain('src="b.png"');
    expect(html).toContain('src="https://example.com/c.png"');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("currentMarkdownVariables", () => {
  it("includes the page colours as well as the Markdown ones", () => {
    const values: Record<string, string> = { "--bg": "#101010", "--text": "#efefef", "--code-bg": "#202020" };
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) => values[name] ?? "",
    } as CSSStyleDeclaration);
    const vars = currentMarkdownVariables();
    vi.restoreAllMocks();
    expect(vars["--bg"]).toBe("#101010");
    expect(vars["--text"]).toBe("#efefef");
    expect(vars["--code-bg"]).toBe("#202020");
  });
});

describe("htmlDocument", () => {
  const page = (body: string, overrides = {}) =>
    htmlDocument({
      title: "Notes <draft>",
      body,
      theme: "dark",
      style: "github",
      variables: { "--bg": "#111", "--text": "#eee" },
      wrap: true,
      justify: false,
      ...overrides,
    });

  it("is a standalone page with the theme, style and variables", () => {
    const html = page("<p>Hi</p>");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en" data-theme="dark" data-style="github">');
    expect(html).toContain("<title>Notes &lt;draft&gt;</title>");
    expect(html).toContain("  --bg: #111;");
    expect(html).toContain("color-scheme: dark;");
    // The Markdown stylesheet itself, not just the page rules around it.
    expect(html).toContain(".markdown blockquote.alert {");
    expect(html).toContain('<article class="markdown wrap">\n<p>Hi</p>');
  });

  it("links KaTeX's stylesheet only when the document has math", () => {
    expect(page("<p>Hi</p>")).not.toContain("katex.min.css");
    expect(page('<span class="katex">x</span>')).toMatch(/<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[\d.]+\/dist\/katex\.min\.css" integrity="sha384-[A-Za-z0-9+/]{64}" crossorigin="anonymous">/);
  });

  it("applies the wrap and justify settings", () => {
    expect(page("", { wrap: false, justify: true })).toContain('<article class="markdown nowrap justify">');
  });
});
