import {
  Component,
  memo,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { Components } from "react-markdown";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Check, Copy, ImageOff } from "lucide-react";
import { decodeLink, dirname, isMarkdown, resolve, splitLink } from "../lib/paths";
import { CLOBBER_PREFIX, languageOf, parseFrontmatter, textOf } from "../lib/markdown";
import { BlockRenderer } from "../lib/blockRenderer";
import { blocksImage, type RemoteImages } from "../lib/settings";
import { renderMermaid, useMermaidTheme } from "../lib/mermaid";
import {
  clearHighlights,
  highlightAt,
  highlightMarkers,
  paintHighlights,
  type SourceHighlight,
} from "../lib/previewComments";
import ScrollMarkers, { sameMarkers, type ScrollMarker } from "./ScrollMarkers";
import Minimap, { MINIMAP_WIDTH } from "./Minimap";

interface PreviewProps {
  content: string;
  filePath: string;
  root: string;
  wrap: boolean;
  justify: boolean;
  showFrontmatter: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll?: (el: HTMLDivElement) => void;
  /** A link to another file was followed, with the `#fragment` it points at, if any. */
  onOpenFile: (path: string, anchor?: string) => void;
  /** Commented text to highlight, as ranges of `content`. */
  highlights?: SourceHighlight[];
  /** A highlight was clicked (its id), or the text outside them (null). */
  onSelectHighlight?: (id: string | null) => void;
  /** The mouse moved onto a highlight (its id) or off them all (null). */
  onHoverHighlight?: (id: string | null, x: number, y: number) => void;
  /** A minimap of the page in place of the scrollbar. */
  minimap?: boolean;
  /** Images from the web to load. */
  remoteImages?: RemoteImages;
}

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

/** Offset from the top of the preview at which a section counts as "current". */
const READING_OFFSET = 90;

interface LinePoint {
  line: number;
  /** Position in the preview's scrollable content. */
  top: number;
}

/**
 * Where source lines are on the page: each block tagged with its line
 * (`data-line`, or `data-line-offset` from the top-level block around it),
 * between the start of the document and the end of its last line.
 */
function linePoints(el: HTMLElement): LinePoint[] {
  const origin = el.getBoundingClientRect().top - el.scrollTop;
  const lastLine = Number(el.querySelector<HTMLElement>("[data-source-lines]")?.dataset.sourceLines ?? 1);
  const points: LinePoint[] = [{ line: 1, top: 0 }];
  for (const block of el.querySelectorAll<HTMLElement>("[data-line], [data-line-offset]")) {
    let line = Number(block.dataset.line);
    if (block.dataset.line === undefined) {
      const top = block.parentElement?.closest<HTMLElement>("[data-line]");
      if (!top) continue;
      line = Number(top.dataset.line) + Number(block.dataset.lineOffset);
    }
    // Hidden (in a closed <details>): it has no place on the page.
    if (block.getClientRects().length === 0) continue;
    const top = block.getBoundingClientRect().top - origin;
    const last = points[points.length - 1];
    // Keep lines and positions both increasing, so either can be interpolated from the other.
    if (line > last.line && top >= last.top) points.push({ line, top });
  }
  points.push({ line: lastLine + 1, top: Math.max(el.scrollHeight, points[points.length - 1].top) });
  return points;
}

/**
 * The source line at `offset` pixels below the top of the preview, with the
 * fraction of the way to the next line: interpolated between the blocks
 * around that point, as VS Code's preview does.
 */
export function previewLineAt(el: HTMLElement, offset = 0): number {
  const y = el.scrollTop + offset;
  const points = linePoints(el);
  let i = 0;
  while (i + 2 < points.length && points[i + 1].top <= y) i++;
  const [prev, next] = [points[i], points[i + 1]];
  if (next.top <= prev.top) return prev.line;
  return prev.line + (Math.min(1, Math.max(0, (y - prev.top) / (next.top - prev.top))) * (next.line - prev.line));
}

/** The scroll position that puts source line `line` (with a fraction) at the top of the preview. */
export function previewScrollTopFor(el: HTMLElement, line: number): number {
  const points = linePoints(el);
  let i = 0;
  while (i + 2 < points.length && points[i + 1].line <= line) i++;
  const [prev, next] = [points[i], points[i + 1]];
  const ratio = Math.min(1, Math.max(0, (line - prev.line) / (next.line - prev.line)));
  return prev.top + ratio * (next.top - prev.top);
}

/** Source line of the block at the top of the preview's viewport. */
export function previewTopLine(el: HTMLElement): number {
  return Math.floor(previewLineAt(el, READING_OFFSET));
}

/** Scrolls the preview, animated, so source line `line` is near the top. */
export function revealPreviewLine(el: HTMLElement, line: number) {
  animateScroll(el, Math.max(0, previewScrollTopFor(el, line) - 24));
}

/**
 * The element a `#fragment` (already decoded) points at, if the page has one.
 * Ids and names from the document's HTML carry a prefix, so `#top` also
 * finds `<a name="top">`, as on GitHub.
 */
export function previewAnchor(el: HTMLElement, id: string): HTMLElement | null {
  for (const v of [id, CLOBBER_PREFIX + id].map((v) => CSS.escape(v))) {
    const target = el.querySelector<HTMLElement>(`[id="${v}"], a[name="${v}"]`);
    if (target) return target;
  }
  return null;
}

/** Scrolls the preview so `target` is near the top. */
export function revealPreviewElement(el: HTMLElement, target: HTMLElement) {
  const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top;
  animateScroll(el, Math.max(0, el.scrollTop + top - 24));
}

const animations = new WeakMap<HTMLElement, () => void>();

/**
 * Scrolls with a JS animation rather than `behavior: "smooth"`, which WebKit
 * cancels whenever anything else scrolls during the animation. The user can
 * still interrupt it by scrolling.
 */
function animateScroll(el: HTMLElement, to: number, duration = 380) {
  animations.get(el)?.();
  const from = el.scrollTop;
  const max = el.scrollHeight - el.clientHeight;
  const target = Math.min(to, max);
  if (Math.abs(target - from) < 1) return;

  const start = performance.now();
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    el.removeEventListener("wheel", stop);
    el.removeEventListener("pointerdown", stop);
    animations.delete(el);
  };
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.scrollTop = from + (target - from) * eased;
    if (t < 1) frame = requestAnimationFrame(step);
    else stop();
  };
  el.addEventListener("wheel", stop, { passive: true });
  el.addEventListener("pointerdown", stop);
  animations.set(el, stop);
  frame = requestAnimationFrame(step);
}

/** Scroll offset per document, so switching tabs returns to the same spot. */
const scrollPositions = new Map<string, number>();

export default function Preview(props: PreviewProps) {
  const { content, filePath, root, wrap, justify, showFrontmatter, scrollRef, onOpenFile, onScroll } = props;
  const { highlights, onSelectHighlight, onHoverHighlight, minimap, remoteImages = "all" } = props;
  // Blocked images the reader chose to load anyway, for as long as the document is open.
  const [allowedImages, setAllowedImages] = useState<ReadonlySet<string>>(() => new Set());
  const hoverFrame = useRef(0);
  const articleRef = useRef<HTMLElement>(null);
  const [markers, setMarkers] = useState<ScrollMarker[]>([]);
  // Keeps the blocks of the document rendered, to render again only what an edit changes.
  const [renderer] = useState(() => new BlockRenderer());
  // Keep typing responsive in split mode: render the preview at lower priority.
  const deferred = useDeferredValue(content);
  const sourceLines = useMemo(() => deferred.split(/\r\n?|\n/).length, [deferred]);
  const frontmatter = useMemo(
    () => (showFrontmatter ? parseFrontmatter(deferred) : null),
    [deferred, showFrontmatter],
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = scrollPositions.get(filePath) ?? 0;
  }, [filePath, scrollRef]);

  // Highlights are ranges of the latest content; paint them once the page shows it.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || deferred !== content) return;
    paintHighlights(el, content, highlights ?? []);
    const update = () => {
      const next = highlightMarkers(el);
      setMarkers((prev) => (sameMarkers(prev, next) ? prev : next));
    };
    update();
    // Images, diagrams and window resizes move the text after it's painted.
    const observer = new ResizeObserver(update);
    if (articleRef.current) observer.observe(articleRef.current);
    observer.observe(el);
    return () => observer.disconnect();
  }, [deferred, content, highlights, scrollRef]);
  useEffect(() => {
    const el = scrollRef.current;
    return () => {
      if (el) clearHighlights(el);
    };
  }, [scrollRef]);

  const components = useMemo<Components>(() => {
    const baseDir = dirname(filePath);
    const toLocal = (src: string) =>
      src.startsWith("/") ? resolve(root, src.slice(1)) : resolve(baseDir, src);

    const scrollToAnchor = (id: string) => {
      const container = scrollRef.current;
      const target = container && previewAnchor(container, id);
      if (container && target) revealPreviewElement(container, target);
    };

    const followLink = (href: string) => {
      if (EXTERNAL.test(href)) {
        openUrl(href).catch(console.error);
        return;
      }
      const { path, anchor } = splitLink(href);
      const target = path ? toLocal(path) : filePath;
      if (target === filePath) {
        if (anchor) scrollToAnchor(anchor);
      } else if (isMarkdown(target)) {
        onOpenFile(target, anchor || undefined);
      } else {
        revealItemInDir(target).catch(console.error);
      }
    };

    return {
      a({ node: _node, href, children, ...rest }) {
        return (
          <a
            {...rest}
            href={href}
            title={rest.title ?? href}
            onClick={(e) => {
              e.preventDefault();
              if (href) followLink(href);
            }}
          >
            {children}
          </a>
        );
      },
      img({ node: _node, src, alt, ...rest }) {
        if (typeof src === "string" && blocksImage(remoteImages, src) && !allowedImages.has(src)) {
          return (
            <BlockedImage
              src={src}
              alt={alt ?? ""}
              onLoad={() => setAllowedImages((prev) => new Set(prev).add(src))}
            />
          );
        }
        const source =
          typeof src === "string" && src && !EXTERNAL.test(src)
            ? convertFileSrc(toLocal(decodeLink(src)))
            : src;
        return <img {...rest} src={source} alt={alt ?? ""} loading="lazy" />;
      },
      pre({ node, children, ...rest }) {
        if (languageOf(node) === "mermaid") {
          // Keep the source line, for scroll sync and the outline.
          const { "data-line": line, "data-line-offset": offset } = rest as Record<string, number | undefined>;
          return <MermaidBlock code={textOf(node)} line={line} offset={offset} />;
        }
        return (
          <CodeBlock language={languageOf(node)} {...rest}>
            {children}
          </CodeBlock>
        );
      },
      // <picture> sources: a blocked one is left out, so the <img> inside (blocked or not) shows.
      source({ node: _node, srcSet, ...rest }) {
        const urls = typeof srcSet === "string" ? srcSet.split(",").map((c) => c.trim().split(/\s+/)[0]) : [];
        if (urls.some((u) => blocksImage(remoteImages, u) && !allowedImages.has(u))) return null;
        return <source {...rest} srcSet={srcSet} />;
      },
      table({ node: _node, children, ...rest }) {
        return (
          <div className="table-wrap">
            <table {...rest}>{children}</table>
          </div>
        );
      },
    };
  }, [filePath, root, onOpenFile, scrollRef, remoteImages, allowedImages]);

  // The minimap shows a copy of the rendered page, made again as it changes.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [page, setPage] = useState<{ html: string; width: number } | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    const article = articleRef.current;
    setScroller(minimap ? el : null);
    if (!minimap || !el || !article) return setPage(null);
    let timer = 0;
    const copy = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = { html: article.outerHTML, width: el.clientWidth };
        setPage((prev) => (prev?.html === next.html && prev.width === next.width ? prev : next));
      }, 150);
    };
    copy();
    // Typing, Mermaid diagrams appearing, images loading, the pane resizing.
    const mutations = new MutationObserver(copy);
    mutations.observe(article, { subtree: true, childList: true, characterData: true, attributes: true });
    const resizes = new ResizeObserver(copy);
    resizes.observe(el);
    return () => {
      window.clearTimeout(timer);
      mutations.disconnect();
      resizes.disconnect();
    };
  }, [minimap, scrollRef]);

  const selectMarker = (id: string) => {
    const el = scrollRef.current;
    const marker = markers.find((m) => m.id === id);
    if (el && marker) animateScroll(el, Math.max(0, marker.top * el.scrollHeight - el.clientHeight / 3));
    onSelectHighlight?.(id);
  };

  return (
    <div className={`pane ${minimap ? "with-minimap" : ""}`}>
      <div
        className="preview"
        ref={scrollRef}
        onScroll={(e) => {
          scrollPositions.set(filePath, e.currentTarget.scrollTop);
          onScroll?.(e.currentTarget);
        }}
        onMouseMove={(e) => {
          if (!onHoverHighlight) return;
          const { currentTarget: el, clientX: x, clientY: y, buttons } = e;
          cancelAnimationFrame(hoverFrame.current);
          hoverFrame.current = requestAnimationFrame(() =>
            // Not while selecting text.
            onHoverHighlight(buttons ? null : highlightAt(el, x, y), x, y),
          );
        }}
        onMouseLeave={(e) => {
          cancelAnimationFrame(hoverFrame.current);
          onHoverHighlight?.(null, e.clientX, e.clientY);
        }}
        onClick={(e) => {
          if (!onSelectHighlight || !window.getSelection()?.isCollapsed) return;
          onSelectHighlight(highlightAt(e.currentTarget, e.clientX, e.clientY));
        }}
      >
        <article
          ref={articleRef}
          className={`markdown ${wrap ? "wrap" : "nowrap"} ${justify ? "justify" : ""}`}
          data-source-lines={sourceLines}
        >
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
          <RenderBoundary source={deferred}>
            <RenderedMarkdown source={deferred} components={components} renderer={renderer} />
          </RenderBoundary>
        </article>
      </div>
      {minimap ? (
        <Minimap
          scroller={scroller}
          scale={page ? MINIMAP_WIDTH / page.width : 0.1}
          markers={markers}
          onSelectMarker={selectMarker}
        >
          {page && (
            <div
              className="minimap-page"
              style={{ width: page.width, transform: `scale(${MINIMAP_WIDTH / page.width})` }}
              // A copy of the page above, already rendered and sanitized.
              dangerouslySetInnerHTML={{ __html: page.html }}
            />
          )}
        </Minimap>
      ) : (
        <ScrollMarkers markers={markers} onSelect={selectMarker} />
      )}
    </div>
  );
}

const RenderedMarkdown = memo(function RenderedMarkdown({
  source,
  components,
  renderer,
}: {
  source: string;
  components: Components;
  renderer: BlockRenderer;
}) {
  return <>{renderer.render(source, components)}</>;
});

/**
 * Shows a render error in the page instead of letting it unmount the app,
 * and tries again once the source changes.
 */
class RenderBoundary extends Component<
  { source: string; children: ReactNode },
  { error: Error | null; source: string }
> {
  state = { error: null as Error | null, source: this.props.source };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { source: string }, state: { source: string }) {
    return props.source === state.source ? null : { error: null, source: props.source };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="render-error">
        <div className="render-error-title">This document couldn't be rendered</div>
        <pre>{this.state.error.message}</pre>
      </div>
    );
  }
}

/** In place of an image from the web that isn't loaded: its alt text and server; a click loads it. */
function BlockedImage({ src, alt, onLoad }: { src: string; alt: string; onLoad: () => void }) {
  let host = src;
  try {
    host = new URL(src, "https://x").host;
  } catch {
    // Not a URL after all: show it as written.
  }
  return (
    <button className="blocked-image" title={`Image from ${src} not loaded (Settings → Images from the web). Click to load it.`} onClick={onLoad}>
      <ImageOff size={14} aria-hidden />
      <span>{alt || "Image"}</span>
      <span className="blocked-image-host">{host}</span>
    </button>
  );
}

function MermaidBlock({ code, line, offset }: { code: string; line?: number; offset?: number }) {
  const theme = useMermaidTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    renderMermaid(code, theme).then(
      (result) => {
        if (!current) return;
        setSvg(result);
        setError(null);
      },
      (e) => {
        if (current) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      current = false;
    };
  }, [code, theme]);

  if (error) {
    return (
      <div className="mermaid-error" data-line={line} data-line-offset={offset}>
        <div className="mermaid-error-title">Mermaid diagram error</div>
        <pre>{error}</pre>
      </div>
    );
  }
  // Mermaid sanitizes the diagram itself (securityLevel "strict").
  // While a new version renders, the previous one stays to avoid flicker.
  return svg ? (
    <div className="mermaid-diagram" data-line={line} data-line-offset={offset} dangerouslySetInnerHTML={{ __html: svg }} />
  ) : (
    <div className="mermaid-diagram loading" data-line={line} data-line-offset={offset}>
      Rendering diagram…
    </div>
  );
}

function CodeBlock({ language, children, ...rest }: { language?: string; children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = ref.current?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text.replace(/\n$/, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className={`code-block ${language ? "has-lang" : ""}`}>
      <div className="code-meta">
        {language && <span className="code-lang">{language}</span>}
        <button className="code-copy" onClick={copy} title="Copy code">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre ref={ref} {...rest}>
        {children}
      </pre>
    </div>
  );
}
