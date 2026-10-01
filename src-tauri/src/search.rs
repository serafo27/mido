//! Full-text search across the Markdown files of the open folder.

use std::fs;
use std::path::PathBuf;

use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

/// Stop after this many matching lines, so a one-letter query stays fast.
const MAX_MATCHES: usize = 1000;
/// Files bigger than this are skipped: they're unlikely to be notes.
const MAX_FILE_SIZE: u64 = 4 * 1024 * 1024;
/// Longer lines are cut to a window around their first match.
const MAX_LINE_CHARS: usize = 240;
/// How much of the line to keep before the first match when cutting it.
const CONTEXT_CHARS: usize = 40;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LineMatch {
    /// 1-based line number.
    pub line: usize,
    /// The line, trimmed and possibly cut (with "…") around the first match.
    pub text: String,
    /// Matches within `text`, as [start, end) offsets in UTF-16 code units,
    /// so JavaScript can slice `text` with them directly.
    pub ranges: Vec<(usize, usize)>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileMatches {
    pub path: String,
    pub matches: Vec<LineMatch>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub files: Vec<FileMatches>,
    /// More matches exist than were returned.
    pub truncated: bool,
}

fn pattern(query: &str, options: &SearchOptions) -> Option<Regex> {
    let mut pattern = regex::escape(query);
    if options.whole_word {
        pattern = format!(r"\b{pattern}\b");
    }
    RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        .build()
        .ok()
}

/// Searches `files` (in order) for `query`, matched literally.
pub fn search(files: &[PathBuf], query: &str, options: &SearchOptions) -> SearchResults {
    let mut results = SearchResults { files: Vec::new(), truncated: false };
    if query.trim().is_empty() {
        return results;
    }
    let Some(re) = pattern(query, options) else {
        return results;
    };

    let mut total = 0;
    for path in files {
        if fs::metadata(path).map(|m| m.len() > MAX_FILE_SIZE).unwrap_or(true) {
            continue;
        }
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        let mut matches = Vec::new();
        for (i, line) in content.lines().enumerate() {
            let found: Vec<(usize, usize)> = re.find_iter(line).map(|m| (m.start(), m.end())).collect();
            if found.is_empty() {
                continue;
            }
            if total == MAX_MATCHES {
                results.truncated = true;
                break;
            }
            total += 1;
            matches.push(line_match(i + 1, line, &found));
        }
        if !matches.is_empty() {
            results.files.push(FileMatches { path: path.to_string_lossy().into_owned(), matches });
        }
        if results.truncated {
            break;
        }
    }
    results
}

/// Builds the displayed snippet for a line, given its matches as byte ranges.
fn line_match(line: usize, text: &str, found: &[(usize, usize)]) -> LineMatch {
    let trimmed_start = text.len() - text.trim_start().len();
    let text_end = text.trim_end().len();

    // Cut long lines to a window that starts a little before the first match.
    let first = found[0].0.max(trimmed_start);
    let mut start = trimmed_start;
    if text[start..text_end].chars().count() > MAX_LINE_CHARS {
        let before: Vec<(usize, char)> = text[trimmed_start..first].char_indices().collect();
        if before.len() > CONTEXT_CHARS {
            start = trimmed_start + before[before.len() - CONTEXT_CHARS].0;
        }
    }
    let end = text[start..text_end]
        .char_indices()
        .nth(MAX_LINE_CHARS)
        .map_or(text_end, |(i, _)| start + i);

    let prefix = if start > trimmed_start { "…" } else { "" };
    let suffix = if end < text_end { "…" } else { "" };
    let snippet = format!("{prefix}{}{suffix}", &text[start..end]);

    // Byte offset in `text` → UTF-16 offset in `snippet`.
    let utf16 = |byte: usize| prefix.encode_utf16().count() + text[start..byte].encode_utf16().count();
    let ranges = found
        .iter()
        .map(|&(s, e)| (s.clamp(start, end), e.clamp(start, end)))
        .filter(|(s, e)| s < e)
        .map(|(s, e)| (utf16(s), utf16(e)))
        .collect();

    LineMatch { line, text: snippet, ranges }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn search_in(files: &[(&str, &str)], query: &str, options: SearchOptions) -> (tempfile::TempDir, SearchResults) {
        let dir = tempfile::tempdir().unwrap();
        let paths: Vec<PathBuf> = files
            .iter()
            .map(|(name, content)| {
                let path = dir.path().join(name);
                fs::write(&path, content).unwrap();
                path
            })
            .collect();
        let results = search(&paths, query, &options);
        (dir, results)
    }

    /// The matched parts of a line, sliced the way JavaScript would.
    fn hits(m: &LineMatch) -> Vec<String> {
        let units: Vec<u16> = m.text.encode_utf16().collect();
        m.ranges.iter().map(|&(s, e)| String::from_utf16(&units[s..e]).unwrap()).collect()
    }

    #[test]
    fn finds_matches_case_insensitively_by_default() {
        let (_dir, results) = search_in(
            &[("a.md", "# Title\nHello world\nhello again, HELLO"), ("b.md", "nothing here")],
            "hello",
            SearchOptions::default(),
        );
        assert_eq!(results.files.len(), 1);
        let matches = &results.files[0].matches;
        assert_eq!(matches.iter().map(|m| m.line).collect::<Vec<_>>(), vec![2, 3]);
        assert_eq!(hits(&matches[1]), vec!["hello", "HELLO"]);
        assert!(!results.truncated);
    }

    #[test]
    fn respects_case_and_whole_word_options() {
        let files = [("a.md", "Note notes NOTE note")];
        let (_dir, results) = search_in(&files, "note", SearchOptions { case_sensitive: true, whole_word: false });
        assert_eq!(hits(&results.files[0].matches[0]), vec!["note", "note"]);
        let (_dir, results) = search_in(&files, "note", SearchOptions { case_sensitive: false, whole_word: true });
        assert_eq!(hits(&results.files[0].matches[0]), vec!["Note", "NOTE", "note"]);
    }

    #[test]
    fn matches_the_query_literally() {
        let (_dir, results) = search_in(&[("a.md", "a.b axb (x) [y]")], "a.b", SearchOptions::default());
        assert_eq!(hits(&results.files[0].matches[0]), vec!["a.b"]);
        let (_dir, results) = search_in(&[("a.md", "a.b axb (x) [y]")], "(x)", SearchOptions::default());
        assert_eq!(hits(&results.files[0].matches[0]), vec!["(x)"]);
    }

    #[test]
    fn reports_ranges_in_utf16_units() {
        let (_dir, results) = search_in(&[("a.md", "  città 🎉 caffè")], "caffè", SearchOptions::default());
        let m = &results.files[0].matches[0];
        assert_eq!(m.text, "città 🎉 caffè");
        assert_eq!(m.ranges, vec![(9, 14)]);
        assert_eq!(hits(m), vec!["caffè"]);
    }

    #[test]
    fn cuts_long_lines_around_the_first_match() {
        let line = format!("{}needle{}", "x".repeat(500), "y".repeat(500));
        let (_dir, results) = search_in(&[("a.md", &line)], "needle", SearchOptions::default());
        let m = &results.files[0].matches[0];
        assert!(m.text.starts_with('…') && m.text.ends_with('…'));
        assert_eq!(m.text.chars().count(), MAX_LINE_CHARS + 2);
        assert_eq!(hits(m), vec!["needle"]);
    }

    #[test]
    fn stops_at_the_match_limit() {
        let content = "match\n".repeat(MAX_MATCHES + 10);
        let (_dir, results) = search_in(&[("a.md", &content), ("b.md", "match")], "match", SearchOptions::default());
        assert_eq!(results.files.len(), 1);
        assert_eq!(results.files[0].matches.len(), MAX_MATCHES);
        assert!(results.truncated);
    }

    #[test]
    fn ignores_blank_queries() {
        let (_dir, results) = search_in(&[("a.md", "   ")], "  ", SearchOptions::default());
        assert!(results.files.is_empty());
    }
}
