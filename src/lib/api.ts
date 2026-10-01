import { invoke } from "@tauri-apps/api/core";
import type { Author, CommentFileData } from "./comments";

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
  /**
   * Asks for a folder in the native dialog; resolves to it, or null if cancelled.
   * Folders picked this way open without the confirmation `openFolder` asks for others.
   */
  pickFolder: () => invoke<string | null>("pick_folder"),
  readTree: () => invoke<FileNode[]>("read_tree"),
  searchFiles: (query: string, options: SearchOptions) =>
    invoke<SearchResults>("search_files", { query, options }),
  /** Asks where to save, then writes the page; resolves to the saved path, or null if cancelled. */
  exportHtml: (defaultPath: string, html: string) => invoke<string | null>("export_html", { defaultPath, html }),
  /**
   * Saves an image in the `assets` folder next to `document` (never replacing
   * a file) and resolves to its path relative to the document. The bytes go
   * as the raw request body rather than JSON.
   */
  saveAsset: async (document: string, file: File, name: string) =>
    invoke<string>("save_asset", new Uint8Array(await file.arrayBuffer()), {
      headers: {
        "x-document": encodeURIComponent(document),
        "x-name": encodeURIComponent(name),
        "x-mime": encodeURIComponent(file.type),
      },
    }),
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
  /** Every comment file of `document`, from `.mido/comments`. */
  readComments: (document: string) => invoke<CommentFileData[]>("read_comments", { document }),
  /** Adds a file to a thread of `document`; fails rather than replace one. */
  addCommentFile: (document: string, thread: string, name: string, content: string) =>
    invoke<void>("add_comment_file", { document, thread, name, content }),
  /** Writes `name`, holding every event of the files in `replaces`, then removes those files. */
  compactCommentThread: (document: string, thread: string, name: string, content: string, replaces: string[]) =>
    invoke<void>("compact_comment_thread", { document, thread, name, content, replaces }),
  /** The git user of the open folder, who comments are signed by; null without one. */
  gitIdentity: () => invoke<Author | null>("git_identity"),
};
