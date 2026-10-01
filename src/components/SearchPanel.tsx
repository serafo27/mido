import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaseSensitive, FileText, Search, WholeWord, X } from "lucide-react";
import { api, type FileNode, type LineMatch, type SearchResults } from "../lib/api";
import { basename, dirname, relative } from "../lib/paths";
import { useStoredState } from "../lib/useStoredState";

interface SearchPanelProps {
  /** Hidden rather than unmounted, so the query and results survive switching views. */
  visible: boolean;
  root: string;
  /** Searching again when the tree changes keeps results in step with the files on disk. */
  tree: FileNode[];
  activePath: string | null;
  onOpenMatch: (path: string, line: number) => void;
  onClose: () => void;
}

const DEBOUNCE_MS = 180;

export default function SearchPanel({ visible, root, tree, activePath, onOpenMatch, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useStoredState("mido.search.caseSensitive", false);
  const [wholeWord, setWholeWord] = useStoredState("mido.search.wholeWord", false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const run = useRef(0);

  useEffect(() => {
    if (!visible) return;
    const focus = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    focus();
    window.addEventListener("mido:focus-search", focus);
    return () => window.removeEventListener("mido:focus-search", focus);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const id = ++run.current;
    if (!query.trim()) {
      setResults(null);
      setError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api.searchFiles(query, { caseSensitive, wholeWord }).then(
        (r) => {
          // Ignore answers to queries that have since changed.
          if (id !== run.current) return;
          setResults(r);
          setError(null);
        },
        (e) => {
          if (id === run.current) setError(String(e));
        },
      );
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [visible, query, caseSensitive, wholeWord, tree, root]);

  const total = results?.files.reduce((n, f) => n + f.matches.length, 0) ?? 0;

  return (
    <div className="search-panel" hidden={!visible}>
      <div className="filter search-input">
        <Search size={13} className="filter-icon" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (query) setQuery("");
              else onClose();
            } else if (e.key === "Enter") {
              const first = results?.files[0];
              if (first) onOpenMatch(first.path, first.matches[0].line);
            }
          }}
          placeholder="Search in files"
          spellCheck={false}
        />
        <div className="search-options">
          {query && (
            <button className="search-option" onClick={() => setQuery("")} title="Clear">
              <X size={12} />
            </button>
          )}
          <button
            className={`search-option ${caseSensitive ? "active" : ""}`}
            onClick={() => setCaseSensitive((v) => !v)}
            title="Match case"
            aria-pressed={caseSensitive}
          >
            <CaseSensitive size={15} />
          </button>
          <button
            className={`search-option ${wholeWord ? "active" : ""}`}
            onClick={() => setWholeWord((v) => !v)}
            title="Match whole word"
            aria-pressed={wholeWord}
          >
            <WholeWord size={15} />
          </button>
        </div>
      </div>

      {results && (
        <div className="search-summary">
          {total === 0
            ? "No results"
            : `${total}${results.truncated ? "+" : ""} ${total === 1 ? "result" : "results"} in ${results.files.length} ${results.files.length === 1 ? "file" : "files"}`}
        </div>
      )}
      {error && <div className="search-summary error">{error}</div>}

      <div className="search-results">
        {results?.files.map((file) => {
          const folder = relative(root, dirname(file.path));
          return (
            <div key={file.path} className="search-file">
              <button
                className={`tree-row search-file-name ${file.path === activePath ? "active" : ""}`}
                onClick={() => onOpenMatch(file.path, file.matches[0].line)}
                title={file.path}
              >
                <FileText size={15} className="icon" />
                <span className="name">{basename(file.path)}</span>
                {folder && <span className="search-folder">{folder}</span>}
                <span className="search-count">{file.matches.length}</span>
              </button>
              {file.matches.map((m) => (
                <button
                  key={m.line}
                  className="search-match"
                  onClick={() => onOpenMatch(file.path, m.line)}
                  title={`Line ${m.line}`}
                >
                  <span className="search-line">{m.line}</span>
                  <span className="search-text">{highlight(m)}</span>
                </button>
              ))}
            </div>
          );
        })}
        {!results && !error && <div className="tree-empty">Type to search the Markdown files in this folder</div>}
      </div>
    </div>
  );
}

function highlight({ text, ranges }: LineMatch): ReactNode[] {
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
