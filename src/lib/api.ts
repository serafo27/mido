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

/** git's one-letter status: M, A, D, R, C, T, or "?" for an untracked file. */
export type GitCode = string;

export interface GitFileChange {
  /** Relative to the repository, with "/". */
  path: string;
  /** The path before a rename. */
  origPath: string | null;
  /** In the index: what the next commit would change. */
  staged: GitCode | null;
  /** In the working tree, not staged yet. */
  unstaged: GitCode | null;
  conflicted: boolean;
  /** The file in the open folder, when it's inside it. */
  local: string | null;
}

export interface GitStatus {
  /** Null when HEAD is detached. */
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  hasCommits: boolean;
  /** A merge or rebase stopped on conflicts. */
  operation: "merge" | "rebase" | null;
  remotes: string[];
  files: GitFileChange[];
}

export interface GitRepo {
  /** The repository's top folder. */
  root: string;
  /** Whether the user let Mido run git here; until then there's no status. */
  trusted: boolean;
  status: GitStatus | null;
}

/** How to commit, beyond the message (the commit dialog's Git options). */
export interface CommitOptions {
  amend?: boolean;
  signOff?: boolean;
  /** "Name <email>"; empty for git's configured identity. */
  author?: string;
}

export interface GitCommit {
  hash: string;
  short: string;
  author: string;
  email: string;
  /** ISO 8601. */
  date: string;
  subject: string;
}

export interface GitBranch {
  /** "main", or "origin/main" for a remote branch. */
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  /** Its last commit's date, ISO 8601, and subject. */
  date: string;
  subject: string;
}

/** Which two versions a diff compares. */
export type DiffKind = "unstaged" | "staged" | "commit" | "working";

export interface FileVersions {
  /** Null when the file doesn't exist on that side (added or deleted). */
  original: string | null;
  modified: string | null;
  /** Not text, or too big to show. */
  binary: boolean;
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
  /** Asks where to save, then writes the Word document; resolves to the saved path, or null if cancelled. */
  exportWord: async (defaultPath: string, document: Blob) =>
    invoke<string | null>("export_word", new Uint8Array(await document.arrayBuffer()), {
      headers: { "x-default-path": encodeURIComponent(defaultPath) },
    }),
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
  /** Opens another window, with no folder open. */
  openNewWindow: () => invoke<void>("open_new_window"),
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
  /** The repository the open folder is in, with its status once trusted; null outside one or without git. */
  gitInfo: () => invoke<GitRepo | null>("git_info"),
  /** Asks in a native prompt whether Mido may run git in the repository; resolves to the answer. */
  gitTrust: () => invoke<boolean>("git_trust"),
  /** `markdownOnly`: only commits that touch Markdown documents or their comments. */
  gitLog: (limit: number, path: string | null = null, markdownOnly = false) =>
    invoke<GitCommit[]>("git_log", { limit, path, markdownOnly }),
  gitCommitFiles: (hash: string) => invoke<GitFileChange[]>("git_commit_files", { hash }),
  gitFileVersions: (kind: DiffKind, path: string, origPath: string | null, commit: string | null) =>
    invoke<FileVersions>("git_file_versions", { kind, path, origPath, commit }),
  gitStage: (paths: string[]) => invoke<void>("git_stage", { paths }),
  gitUnstage: (paths: string[]) => invoke<void>("git_unstage", { paths }),
  gitCommit: (message: string, options?: CommitOptions) => invoke<string>("git_commit", { message, options }),
  /** The last commit's whole message, to start from when amending it. */
  gitLastMessage: () => invoke<string>("git_last_message"),
  /** `setUpstream`: publishes the branch to that remote and tracks it. */
  gitPush: (setUpstream: string | null = null) => invoke<string>("git_push", { setUpstream }),
  gitPull: (mode: "merge" | "rebase") => invoke<string>("git_pull", { mode }),
  gitFetch: () => invoke<string>("git_fetch"),
  /** Writes the resolved contents of a conflicted file and stages it. */
  gitResolve: (path: string, content: string) => invoke<void>("git_resolve", { path, content }),
  gitContinue: () => invoke<string>("git_continue"),
  /** Throws away unstaged changes: tracked files go back to the index, untracked ones to the Trash. */
  gitDiscard: (paths: string[]) => invoke<void>("git_discard", { paths }),
  gitBranches: () => invoke<GitBranch[]>("git_branches"),
  /** Switches branch; a remote one gets a local branch tracking it. */
  gitCheckout: (name: string, remote: boolean) => invoke<string>("git_checkout", { name, remote }),
  gitCreateBranch: (name: string) => invoke<string>("git_create_branch", { name }),
  /** Merges `name` into the current branch. */
  gitMerge: (name: string) => invoke<string>("git_merge", { name }),
  gitDeleteBranch: (name: string) => invoke<string>("git_delete_branch", { name }),
  /** The commits a push would send. */
  gitOutgoing: () => invoke<GitCommit[]>("git_outgoing"),
  gitAbort: () => invoke<string>("git_abort"),
  /** The git user of the open folder, who comments are signed by; null without one. */
  gitIdentity: () => invoke<Author | null>("git_identity"),
};
