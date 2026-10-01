export interface FuzzyMatch {
  score: number;
  /** Positions in the text of the matched characters, for highlighting. */
  indices: number[];
}

const SEPARATORS = "/\\-_ .";

/**
 * Matches the characters of `query` in order anywhere in `text`, ignoring
 * case and spaces ("rdm" matches "README.md"). Higher scores go to runs of
 * consecutive characters, matches at the start of words, and shorter texts.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, indices: [] };
  const lower = text.toLowerCase();

  const wordStart = (i: number) =>
    i === 0 || SEPARATORS.includes(text[i - 1]) || (/[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i]));

  // Try every place the first character occurs and keep the best greedy match.
  let best: FuzzyMatch | null = null;
  for (let start = lower.indexOf(q[0]); start >= 0; start = lower.indexOf(q[0], start + 1)) {
    const indices = [start];
    let score = 1 + (wordStart(start) ? 8 : 0);
    let at = start;
    for (let k = 1; k < q.length; k++) {
      const next = lower.indexOf(q[k], at + 1);
      if (next < 0) {
        score = -Infinity;
        break;
      }
      // A run of characters counts more than scattered word starts ("todo" over "t-o-d-o").
      const consecutive = next === at + 1;
      score += 1 + (consecutive ? 8 : wordStart(next) ? 5 : 0) - Math.min(next - at - 1, 10) * 0.2;
      indices.push(next);
      at = next;
    }
    if (score === -Infinity) break;
    score -= text.length * 0.02;
    if (!best || score > best.score) best = { score, indices };
  }
  return best;
}

/**
 * Matches a file by its path relative to the folder, preferring matches in
 * the file name. The indices refer to `relPath`.
 */
export function matchFile(query: string, relPath: string): FuzzyMatch | null {
  const nameStart = Math.max(relPath.lastIndexOf("/"), relPath.lastIndexOf("\\")) + 1;
  const inName = fuzzyMatch(query, relPath.slice(nameStart));
  if (inName) return { score: inName.score + 20, indices: inName.indices.map((i) => i + nameStart) };
  return fuzzyMatch(query, relPath);
}
