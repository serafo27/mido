import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown, { type Components } from "react-markdown";
import katex from "katex";
import markdownCss from "../styles/markdown.css?raw";
import { languageOf, parseFrontmatter, rehypePlugins, remarkPlugins, textOf } from "./markdown";
import { renderMermaid, type MermaidTheme } from "./mermaid";
import { decodeLink, dirname, resolve } from "./paths";
import { blocksImage, type RemoteImages } from "./settings";

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

export interface RenderOptions {
  source: string;
  filePath: string;
  root: string;
  showFrontmatter: boolean;
  /** Colours of diagrams. */
  mermaid: MermaidTheme;
  /** Turns a local file path into a URL the webview can load (the asset protocol). */
  assetUrl: (path: string) => string;
  /** Inline local images as data URIs, so the result stands on its own. */
  embedImages: boolean;
  /** Images from the web to keep (default all); others show as their alt text. */
  remoteImages?: RemoteImages;
}

/**
 * Renders a document to static HTML, the way the preview shows it: Mermaid
 * diagrams as SVG and local images resolved. Used to print and to export.
 */
export async function renderDocument(options: RenderOptions): Promise<string> {
  const { source, filePath, root, showFrontmatter, assetUrl } = options;
  const baseDir = dirname(filePath);
  const toLocal = (src: string) => (src.startsWith("/") ? resolve(root, src.slice(1)) : resolve(baseDir, src));

  const components: Components = {
    img({ node: _node, src, alt, ...rest }) {
      if (typeof src === "string" && blocksImage(options.remoteImages ?? "all", src)) {
        return <span className="blocked-image">{alt || "Image"}</span>;
      }
      if (typeof src !== "string" || !src || EXTERNAL.test(src)) return <img {...rest} src={src} alt={alt ?? ""} />;
      const path = toLocal(decodeLink(src));
      return <img {...rest} src={assetUrl(path)} alt={alt ?? ""} data-local-path={path} data-original-src={src} />;
    },
    pre({ node, children, ...rest }) {
      const language = languageOf(node);
      if (language === "mermaid") return <div className="mermaid-diagram" data-mermaid={textOf(node)} />;
      return (
        <div className={`code-block ${language ? "has-lang" : ""}`}>
          {language && (
            <div className="code-meta">
              <span className="code-lang">{language}</span>
            </div>
          )}
          <pre {...rest}>{children}</pre>
        </div>
      );
    },
    table({ node: _node, children, ...rest }) {
      return (
        <div className="table-wrap">
          <table {...rest}>{children}</table>
        </div>
      );
    },
  };

  const frontmatter = showFrontmatter ? parseFrontmatter(source) : null;
  const markup = renderToStaticMarkup(
    <>
      {frontmatter && (
        <dl className="frontmatter">
          {frontmatter.map(({ key, value }) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value || "—"}</dd>
            </div>
          ))}
        </dl>
      )}
      <ReactMarkdown remarkPlugins={remarkPlugins as never} rehypePlugins={rehypePlugins as never} components={components}>
        {source}
      </ReactMarkdown>
    </>,
  );

  const doc = new DOMParser().parseFromString(`<body>${markup}</body>`, "text/html");
  for (const el of doc.querySelectorAll("[data-line], [data-line-offset]")) {
    el.removeAttribute("data-line");
    el.removeAttribute("data-line-offset");
  }

  for (const el of doc.querySelectorAll<HTMLElement>("[data-mermaid]")) {
    const code = el.dataset.mermaid ?? "";
    el.removeAttribute("data-mermaid");
    try {
      el.innerHTML = await renderMermaid(code, options.mermaid);
    } catch (e) {
      el.className = "mermaid-error";
      const title = doc.createElement("div");
      title.className = "mermaid-error-title";
      title.textContent = "Mermaid diagram error";
      const message = doc.createElement("pre");
      message.textContent = e instanceof Error ? e.message : String(e);
      el.append(title, message);
    }
  }

  await Promise.all(
    [...doc.querySelectorAll<HTMLImageElement>("img[data-local-path]")].map(async (img) => {
      const path = img.dataset.localPath!;
      const original = img.dataset.originalSrc!;
      img.removeAttribute("data-local-path");
      img.removeAttribute("data-original-src");
      if (!options.embedImages) return;
      try {
        img.src = await dataUrl(assetUrl(path));
      } catch {
        // Not readable (missing, or outside the folder): keep the link as written.
        img.src = original;
      }
    }),
  );

  return doc.body.innerHTML;
}

async function dataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  return new Promise((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result as string);
    reader.onerror = () => fail(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Page styles around the Markdown ones in an exported document. */
const PAGE_CSS = `*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
${markdownCss}
.markdown { padding-bottom: 72px; }`;

/** The CSS variables an exported page uses, with their current values. */
export function currentMarkdownVariables(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const names = new Set([...PAGE_CSS.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  const vars: Record<string, string> = {};
  for (const name of [...names].sort()) {
    const value = style.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  return vars;
}

export interface HtmlDocumentOptions {
  title: string;
  /** Output of `renderDocument`. */
  body: string;
  theme: "light" | "dark";
  /** Reading style preset (`data-style`). */
  style: string;
  variables: Record<string, string>;
  wrap: boolean;
  justify: boolean;
}

/** Subresource Integrity of KaTeX's stylesheet, computed at build time (vite.config.ts). */
declare const __KATEX_CSS_INTEGRITY__: string;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A standalone HTML page with the rendered document and the styles it needs. */
export function htmlDocument(o: HtmlDocumentOptions): string {
  const variables = Object.entries(o.variables)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  // KaTeX's stylesheet and fonts are too big to inline; link them only when needed.
  const katexCss = o.body.includes('class="katex')
    ? `\n<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${katex.version}/dist/katex.min.css" integrity="${__KATEX_CSS_INTEGRITY__}" crossorigin="anonymous">`
    : "";
  return `<!doctype html>
<html lang="en" data-theme="${o.theme}" data-style="${escapeHtml(o.style)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Mido">
<title>${escapeHtml(o.title)}</title>${katexCss}
<style>
:root {
  color-scheme: ${o.theme};
${variables}
}
${PAGE_CSS}
</style>
</head>
<body>
<article class="markdown ${o.wrap ? "wrap" : "nowrap"}${o.justify ? " justify" : ""}">
${o.body}
</article>
</body>
</html>
`;
}
