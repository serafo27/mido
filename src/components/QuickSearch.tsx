import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FileText, Search } from "lucide-react";
import { api, type FileNode, type LineMatch } from "../lib/api";
import { matchFile } from "../lib/fuzzy";
import { basename, relative } from "../lib/paths";
import { isMac } from "../lib/platform";

interface QuickSearchProps {
  root: string;
  tree: FileNode[];
  /** Open tabs, shown before anything is typed. */
  openPaths: string[];
  onOpenFile: (path: string) => void;
  onOpenMatch: (path: string, line: number) => void;
  onClose: () => void;
}

type Item =
  | { kind: "file"; path: string; rel: string; indices: number[] }
  | { kind: "line"; path: string; match: LineMatch };

const MAX_FILES = 8;
const MAX_LINES = 60;
const DEBOUNCE_MS = 150;

function allFiles(nodes: FileNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.isDir) allFiles(node.children ?? [], out);
    else out.push(node.path);
  }
  return out;
}

/** A Spotlight-style search over file names and the text of every file in the folder. */
export default function QuickSearch({ root, tree, openPaths, onOpenFile, onOpenMatch, onClose }: QuickSearchProps) {
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<{ query: string; items: Item[]; total: number; truncated: boolean } | null>(null);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const run = useRef(0);

  useEffect(() => {
    // Give focus back to wherever it was (usually the editor) on close.
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const files = useMemo(() => allFiles(tree), [tree]);

  const fileItems = useMemo<Item[]>(() => {
    const q = query.trim();
    if (!q) {
      return openPaths.map((path) => ({ kind: "file", path, rel: relative(root, path), indices: [] }));
    }
    return files
      .map((path) => {
        const rel = relative(root, path);
        const match = matchFile(q, rel);
        return match && { path, rel, match };
      })
      .filter((x) => x !== null)
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, MAX_FILES)
      .map(({ path, rel, match }) => ({ kind: "file", path, rel, indices: match.indices }));
  }, [query, files, openPaths, root]);

  useEffect(() => {
    const id = ++run.current;
    const q = query.trim();
    if (!q) {
      setLines(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api.searchFiles(q, { caseSensitive: false, wholeWord: false }).then(
        (results) => {
          // Ignore answers to queries that have since changed.
          if (id !== run.current) return;
          const all = results.files.flatMap((f) => f.matches.map((match): Item => ({ kind: "line", path: f.path, match })));
          setLines({ query: q, items: all.slice(0, MAX_LINES), total: all.length, truncated: results.truncated });
        },
        () => {
          if (id === run.current) setLines({ query: q, items: [], total: 0, truncated: false });
        },
      );
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const lineItems = lines?.query === query.trim() ? lines.items : [];
  const items = [...fileItems, ...lineItems];
  const searching = query.trim() !== "" && lines?.query !== query.trim();

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(".quick-item.selected")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const open = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    if (item.kind === "file") onOpenFile(item.path);
    else onOpenMatch(item.path, item.match.line);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(items[selected]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const row = (item: Item, index: number) => {
    const key = `${item.kind}:${item.path}:${item.kind === "line" ? item.match.line : ""}`;
    const props = {
      className: `quick-item ${item.kind} ${index === selected ? "selected" : ""}`,
      onMouseMove: () => index !== selected && setSelected(index),
      onClick: () => open(item),
    };
    if (item.kind === "file") {
      const nameStart = item.rel.length - basename(item.rel).length;
      const folder = item.rel.slice(0, Math.max(0, nameStart - 1));
      return (
        <button key={key} {...props}>
          <FileText size={16} className="icon" />
          <span className="quick-name">{highlightIndices(basename(item.rel), item.indices, nameStart)}</span>
          {folder && <span className="quick-path">{highlightIndices(folder, item.indices, 0)}</span>}
        </button>
      );
    }
    return (
      <button key={key} {...props}>
        <span className="quick-line-file">
          {basename(item.path)}
          <span className="quick-line-number">:{item.match.line}</span>
        </span>
        <span className="quick-snippet">{highlightRanges(item.match)}</span>
      </button>
    );
  };

  const filesTitle = query.trim() ? "Files" : "Open tabs";
  const linesTitle =
    lines && lines.total > lineItems.length
      ? `In files — first ${lineItems.length} of ${lines.total}${lines.truncated ? "+" : ""}`
      : "In files";

  return (
    <div className="quick-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="quick-search" role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKeyDown}>
        <div className="quick-input">
          <Search size={18} className="quick-input-icon" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files and text"
            spellCheck={false}
            autoComplete="off"
          />
          {searching && <span className="quick-spinner" aria-label="Searching" />}
        </div>
        {items.length > 0 && (
          <div className="quick-results" ref={listRef}>
            {fileItems.length > 0 && <div className="quick-section">{filesTitle}</div>}
            {fileItems.map((item, i) => row(item, i))}
            {lineItems.length > 0 && <div className="quick-section">{linesTitle}</div>}
            {lineItems.map((item, i) => row(item, fileItems.length + i))}
          </div>
        )}
        {query.trim() && !searching && items.length === 0 && <div className="quick-empty">No results</div>}
        <div className="quick-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to choose
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span>
            <kbd>esc</kbd> to close
          </span>
          <span className="quick-footer-hint">
            <kbd>{isMac ? "⌘⇧F" : "Ctrl+Shift+F"}</kbd> for search options
          </span>
        </div>
      </div>
    </div>
  );
}

/** Highlights the characters of `text` whose positions (offset by `offset`) are in `indices`. */
function highlightIndices(text: string, indices: number[], offset: number): ReactNode[] {
  const hits = new Set(indices.map((i) => i - offset).filter((i) => i >= 0 && i < text.length));
  if (hits.size === 0) return [text];
  const parts: ReactNode[] = [];
  let run = "";
  let inHit = false;
  const flush = (key: number) => {
    if (run) parts.push(inHit ? <mark key={key}>{run}</mark> : run);
    run = "";
  };
  for (let i = 0; i < text.length; i++) {
    if (hits.has(i) !== inHit) {
      flush(i);
      inHit = hits.has(i);
    }
    run += text[i];
  }
  flush(text.length);
  return parts;
}

function highlightRanges({ text, ranges }: LineMatch): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  parts.push(text.slice(at));
  return parts;
}
