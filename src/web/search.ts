// The desktop app's search (src-tauri/src/search.rs), ported for the web
// version. Keep the two in step: same limits, same snippets, same results.
import type { LineMatch, SearchOptions, SearchResults } from "../lib/api";

const MAX_MATCHES = 1000;
const MAX_LINE_CHARS = 240;
const CONTEXT_CHARS = 40;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function searchPattern(query: string, options: SearchOptions): RegExp {
  let pattern = escapeRegExp(query);
  if (options.wholeWord) pattern = `(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`;
  return new RegExp(pattern, options.caseSensitive ? "gu" : "giu");
}

/** Searches the documents (in order) for `query`, matched literally. */
export function search(docs: { path: string; text: string }[], query: string, options: SearchOptions): SearchResults {
  const results: SearchResults = { files: [], truncated: false };
  if (!query.trim()) return results;
  const re = searchPattern(query, options);

  let total = 0;
  for (const doc of docs) {
    const matches: LineMatch[] = [];
    const lines = doc.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const found = [...lines[i].matchAll(re)].map((m): [number, number] => [m.index, m.index + m[0].length]);
      if (found.length === 0) continue;
      if (total === MAX_MATCHES) {
        results.truncated = true;
        break;
      }
      total++;
      matches.push(lineMatch(i + 1, lines[i], found));
    }
    if (matches.length) results.files.push({ path: doc.path, matches });
    if (results.truncated) break;
  }
  return results;
}

/** The displayed snippet for a line, cut around the first match on long lines. */
export function lineMatch(line: number, text: string, found: [number, number][]): LineMatch {
  const trimmedStart = text.length - text.trimStart().length;
  const textEnd = text.trimEnd().length;
  let start = trimmedStart;
  if (textEnd - start > MAX_LINE_CHARS) start = Math.max(trimmedStart, found[0][0] - CONTEXT_CHARS);
  const end = Math.min(textEnd, start + MAX_LINE_CHARS);

  const prefix = start > trimmedStart ? "…" : "";
  const suffix = end < textEnd ? "…" : "";
  const ranges = found
    .map(([s, e]): [number, number] => [Math.min(Math.max(s, start), end), Math.min(Math.max(e, start), end)])
    .filter(([s, e]) => s < e)
    .map(([s, e]): [number, number] => [s - start + prefix.length, e - start + prefix.length]);
  return { line, text: prefix + text.slice(start, end) + suffix, ranges };
}
