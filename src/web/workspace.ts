// Folders and files opened in the web version. Paths are virtual: a folder
// named "notes" becomes the root "/notes", and its files "/notes/sub/a.md",
// so the app can treat them like paths on disk.
import type { FileNode } from "../lib/api";

export const MARKDOWN = /\.(md|markdown|mdown|mkd|mdx)$/i;
export const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;
// The same folders the desktop app skips (src-tauri/src/lib.rs).
const IGNORED_DIRS = new Set(["node_modules", "target", "dist", "build", "__pycache__"]);
const MAX_DEPTH = 16;

export interface WorkspaceFile {
  path: string;
  file: File;
  /** In Chromium, lets the file be read again after it changes on disk. */
  handle?: FileSystemFileHandle;
}

export interface Workspace {
  root: string;
  /** A real folder (Chromium) that can be read again, or a snapshot of picked or dropped files. */
  source: { kind: "handle"; handle: FileSystemDirectoryHandle } | { kind: "snapshot"; files: WorkspaceFile[] };
  markdown: Map<string, WorkspaceFile>;
  images: Map<string, WorkspaceFile>;
  tree: FileNode[];
}

/** Whether a path relative to the folder is one the desktop app would list (or use as an image). */
export function isIncluded(rel: string): boolean {
  const segments = rel.split("/");
  if (segments.length - 1 > MAX_DEPTH) return false;
  const name = segments[segments.length - 1];
  const dirs = segments.slice(0, -1);
  if (name.startsWith(".") || dirs.some((d) => d.startsWith(".") || IGNORED_DIRS.has(d))) return false;
  return MARKDOWN.test(name) || IMAGE.test(name);
}

/** The sidebar tree for the Markdown files among `paths`: folders first, then files, by name. */
export function buildTree(root: string, paths: string[]): FileNode[] {
  interface Dir {
    dirs: Map<string, Dir>;
    files: string[];
  }
  const top: Dir = { dirs: new Map(), files: [] };
  for (const path of paths) {
    if (!MARKDOWN.test(path)) continue;
    const parts = path.slice(root.length + 1).split("/");
    let dir = top;
    for (const part of parts.slice(0, -1)) {
      if (!dir.dirs.has(part)) dir.dirs.set(part, { dirs: new Map(), files: [] });
      dir = dir.dirs.get(part)!;
    }
    dir.files.push(parts[parts.length - 1]);
  }
  const byName = (a: string, b: string) => {
    const [x, y] = [a.toLowerCase(), b.toLowerCase()];
    return x < y ? -1 : x > y ? 1 : 0;
  };
  const nodes = (dir: Dir, base: string): FileNode[] => [
    ...[...dir.dirs.keys()].sort(byName).map((name) => ({
      name,
      path: `${base}/${name}`,
      isDir: true,
      children: nodes(dir.dirs.get(name)!, `${base}/${name}`),
    })),
    ...dir.files.sort(byName).map((name) => ({ name, path: `${base}/${name}`, isDir: false, children: null })),
  ];
  return nodes(top, root);
}

/** Fills in a workspace's files and tree from `files` (paths already under its root). */
export function indexFiles(workspace: Workspace, files: WorkspaceFile[]) {
  workspace.markdown = new Map();
  workspace.images = new Map();
  for (const f of files) {
    if (MARKDOWN.test(f.path)) workspace.markdown.set(f.path, f);
    else if (IMAGE.test(f.path)) workspace.images.set(f.path, f);
  }
  workspace.tree = buildTree(workspace.root, [...workspace.markdown.keys()]);
}

/** The files of a folder handle (Chromium) under `root`, skipping what the desktop app skips. */
export async function walkHandle(dir: FileSystemDirectoryHandle, root: string): Promise<WorkspaceFile[]> {
  const out: WorkspaceFile[] = [];
  const walk = async (handle: FileSystemDirectoryHandle, rel: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    for await (const entry of handle.values()) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        if (!entry.name.startsWith(".") && !IGNORED_DIRS.has(entry.name)) await walk(entry, path, depth + 1);
      } else if (isIncluded(path)) {
        out.push({ path: `${root}/${path}`, file: await entry.getFile(), handle: entry });
      }
    }
  };
  await walk(dir, "", 0);
  return out;
}

/** The files of a folder dropped in Safari or Firefox (the older entries API). */
export async function walkEntry(dir: FileSystemDirectoryEntry, root: string): Promise<WorkspaceFile[]> {
  const out: WorkspaceFile[] = [];
  const readAll = async (reader: FileSystemDirectoryReader) => {
    const all: FileSystemEntry[] = [];
    // readEntries returns the entries in batches, until an empty one.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((done, fail) => reader.readEntries(done, fail));
      if (batch.length === 0) return all;
      all.push(...batch);
    }
  };
  const walk = async (entry: FileSystemDirectoryEntry, rel: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    for (const child of await readAll(entry.createReader())) {
      const path = rel ? `${rel}/${child.name}` : child.name;
      if (child.isDirectory) {
        if (!child.name.startsWith(".") && !IGNORED_DIRS.has(child.name)) {
          await walk(child as FileSystemDirectoryEntry, path, depth + 1);
        }
      } else if (isIncluded(path)) {
        const file = await new Promise<File>((done, fail) => (child as FileSystemFileEntry).file(done, fail));
        out.push({ path: `${root}/${path}`, file });
      }
    }
  };
  await walk(dir, "", 0);
  return out;
}
