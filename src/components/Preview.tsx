import {
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
import ReactMarkdown, { type Components } from "react-markdown";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Check, Copy } from "lucide-react";
import { dirname, isMarkdown, resolve } from "../lib/paths";
import { languageOf, parseFrontmatter, rehypePlugins, remarkPlugins, textOf } from "../lib/markdown";
import { renderMermaid, useDarkTheme } from "../lib/mermaid";

interface PreviewProps {
  content: string;
  filePath: string;
  root: string;
  wrap: boolean;
  justify: boolean;
  showFrontmatter: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll?: (el: HTMLDivElement) => void;
  onOpenFile: (path: string) => void;
}

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

/** Offset from the top of the preview at which a section counts as "current". */
const READING_OFFSET = 90;

/** Source line of the block at the top of the preview's viewport. */
export function previewTopLine(el: HTMLElement): number {
  const limit = el.getBoundingClientRect().top + READING_OFFSET;
  let line = 1;
  for (const block of el.querySelectorAll<HTMLElement>("[data-line]")) {
    if (block.getBoundingClientRect().top > limit) break;
    line = Number(block.dataset.line);
  }
  return line;
}

/** Scrolls the preview so the block starting at (or before) `line` is at the top. */
export function revealPreviewLine(el: HTMLElement, line: number) {
  let target: HTMLElement | null = null;
  for (const block of el.querySelectorAll<HTMLElement>("[data-line]")) {
    if (Number(block.dataset.line) > line) break;
    target = block;
  }
  if (!target) return;
  const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
  animateScroll(el, Math.max(0, top - 24));
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
  // Keep typing responsive in split mode: render the preview at lower priority.
  const deferred = useDeferredValue(content);
  const frontmatter = useMemo(
    () => (showFrontmatter ? parseFrontmatter(deferred) : null),
    [deferred, showFrontmatter],
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = scrollPositions.get(filePath) ?? 0;
  }, [filePath, scrollRef]);

  const components = useMemo<Components>(() => {
    const baseDir = dirname(filePath);
    const toLocal = (src: string) =>
      src.startsWith("/") ? resolve(root, src.slice(1)) : resolve(baseDir, src);

    const followLink = (href: string) => {
      if (href.startsWith("#")) {
        const id = decodeURIComponent(href.slice(1));
        const container = scrollRef.current;
        const target = container?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
        if (container && target) {
          const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
          animateScroll(container, Math.max(0, container.scrollTop + top - 24));
        }
        return;
      }
      if (EXTERNAL.test(href)) {
        openUrl(href).catch(console.error);
        return;
      }
      const target = toLocal(decodeURI(href.split("#")[0]));
      if (isMarkdown(target)) onOpenFile(target);
      else revealItemInDir(target).catch(console.error);
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
        const source =
          typeof src === "string" && src && !EXTERNAL.test(src)
            ? convertFileSrc(toLocal(decodeURI(src)))
            : src;
        return <img {...rest} src={source} alt={alt ?? ""} loading="lazy" />;
      },
      pre({ node, children, ...rest }) {
        if (languageOf(node) === "mermaid") {
          // Keep the source line, for scroll sync and the outline.
          const line = (rest as Record<string, unknown>)["data-line"] as number | undefined;
          return <MermaidBlock code={textOf(node)} line={line} />;
        }
        return (
          <CodeBlock language={languageOf(node)} {...rest}>
            {children}
          </CodeBlock>
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
  }, [filePath, root, onOpenFile, scrollRef]);

  return (
    <div
      className="preview"
      ref={scrollRef}
      onScroll={(e) => {
        scrollPositions.set(filePath, e.currentTarget.scrollTop);
        onScroll?.(e.currentTarget);
      }}
    >
      <article className={`markdown ${wrap ? "wrap" : "nowrap"} ${justify ? "justify" : ""}`}>
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
        <RenderedMarkdown source={deferred} components={components} />
      </article>
    </div>
  );
}

const RenderedMarkdown = memo(function RenderedMarkdown({
  source,
  components,
}: {
  source: string;
  components: Components;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins as never}
      rehypePlugins={rehypePlugins as never}
      components={components}
    >
      {source}
    </ReactMarkdown>
  );
});



function MermaidBlock({ code, line }: { code: string; line?: number }) {
  const dark = useDarkTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    renderMermaid(code, dark).then(
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
  }, [code, dark]);

  if (error) {
    return (
      <div className="mermaid-error" data-line={line}>
        <div className="mermaid-error-title">Mermaid diagram error</div>
        <pre>{error}</pre>
      </div>
    );
  }
  // Mermaid sanitizes the diagram itself (securityLevel "strict").
  // While a new version renders, the previous one stays to avoid flicker.
  return svg ? (
    <div className="mermaid-diagram" data-line={line} dangerouslySetInnerHTML={{ __html: svg }} />
  ) : (
    <div className="mermaid-diagram loading" data-line={line}>
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
