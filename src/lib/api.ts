import { invoke } from "@tauri-apps/api/core";

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[] | null;
}

/** A file or folder the system asked Mido to open (Finder, Dock, command line). */
export interface OpenRequest {
  path: string;
  isDir: boolean;
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface LineMatch {
  /** 1-based line number. */
  line: number;
  /** The line, trimmed and possibly cut ("…") around the first match. */
  text: string;
  /** Matches within `text`, as [start, end) string offsets. */
  ranges: [number, number][];
}

export interface SearchResults {
  files: { path: string; matches: LineMatch[] }[];
  /** More matches exist than were returned. */
  truncated: boolean;
}

export const api = {
  /** Opens `root` as the workspace (file commands are limited to it) and returns its tree. */
  openFolder: (root: string) => invoke<FileNode[]>("open_folder", { root }),
  readTree: () => invoke<FileNode[]>("read_tree"),
  searchFiles: (query: string, options: SearchOptions) =>
    invoke<SearchResults>("search_files", { query, options }),
  takeOpenRequests: () => invoke<OpenRequest[]>("take_open_requests"),
  readFile: (path: string) => invoke<string>("read_file", { path }),
  /**
   * Writes `content` unless the file on disk no longer matches `expected` (what
   * Mido last read or wrote), in which case nothing is written. `null` overwrites.
   */
  writeFile: (path: string, content: string, expected: string | null) =>
    invoke<"written" | "conflict">("write_file", { path, content, expected }),
  createFile: (path: string) => invoke<void>("create_file", { path }),
  createDir: (path: string) => invoke<void>("create_dir", { path }),
  renamePath: (from: string, to: string) => invoke<void>("rename_path", { from, to }),
  trashPath: (path: string) => invoke<void>("trash_path", { path }),
};
