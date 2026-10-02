// The web version's stand-in for the Rust commands (src-tauri/src/lib.rs):
// the same commands, reading the folders and files the visitor opens in the
// browser. Nothing is ever uploaded, and nothing is ever written.
import type { OpenRequest, SearchOptions } from "../lib/api";
import { WEB_ACCESS_NEEDED } from "../lib/platform";
import { send } from "./events";
import { search } from "./search";
import {
  indexFiles,
  isIncluded,
  walkEntry,
  walkHandle,
  MARKDOWN,
  type Workspace,
  type WorkspaceFile,
} from "./workspace";

const workspaces = new Map<string, Workspace>();
let current: Workspace | null = null;
let openRequests: OpenRequest[] = [];

export class DesktopOnlyError extends Error {}

/* ---------- remembered folders (Chromium) ---------- */

// Folder handles survive reloads in IndexedDB, keyed by their root.
function store<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((done, fail) => {
    const open = indexedDB.open("mido-web", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("folders");
    open.onerror = () => fail(open.error);
    open.onsuccess = () => {
      const request = run(open.result.transaction("folders", mode).objectStore("folders"));
      request.onsuccess = () => done(request.result);
      request.onerror = () => fail(request.error);
    };
  });
}

const rememberFolder = (root: string, handle: FileSystemDirectoryHandle) =>
  store("readwrite", (s) => s.put(handle, root)).catch(() => {});
const rememberedFolder = (root: string) =>
  store<FileSystemDirectoryHandle | undefined>("readonly", (s) => s.get(root)).catch(() => undefined);

/* ---------- workspaces ---------- */

/** A root for a new folder named `name`, not clashing with another open folder. */
function newRoot(name: string): string {
  const base = `/${name.replace(/\//g, "-") || "Folder"}`;
  let root = base;
  for (let n = 2; workspaces.has(root); n++) root = `${base} (${n})`;
  return root;
}

async function reindex(ws: Workspace) {
  const files = ws.source.kind === "handle" ? await walkHandle(ws.source.handle, ws.root) : ws.source.files;
  indexFiles(ws, files);
}

function empty(root: string, source: Workspace["source"]): Workspace {
  return { root, source, markdown: new Map(), images: new Map(), tree: [] };
}

async function addHandle(handle: FileSystemDirectoryHandle): Promise<Workspace> {
  for (const ws of workspaces.values()) {
    if (ws.source.kind === "handle" && (await ws.source.handle.isSameEntry(handle))) return ws;
  }
  const ws = empty(newRoot(handle.name), { kind: "handle", handle });
  workspaces.set(ws.root, ws);
  await rememberFolder(ws.root, handle);
  return ws;
}

/** A snapshot of files: `rel` paths are relative to a folder named `name`. */
function addSnapshot(name: string, files: { rel: string; file: File }[]): Workspace {
  const root = newRoot(name);
  const ws = empty(root, { kind: "snapshot", files: files.map((f) => ({ path: `${root}/${f.rel}`, file: f.file })) });
  workspaces.set(root, ws);
  return ws;
}

async function ensureReadable(handle: FileSystemDirectoryHandle) {
  if (!handle.queryPermission) return;
  if ((await handle.queryPermission({ mode: "read" })) === "granted") return;
  // Only works right after a click; at startup the visitor has to click the folder.
  const state = await handle.requestPermission?.({ mode: "read" }).catch(() => "prompt" as const);
  if (state !== "granted") throw new Error(WEB_ACCESS_NEEDED);
}

function workspaceOf(path: string): Workspace {
  for (const ws of workspaces.values()) {
    if (path === ws.root || path.startsWith(`${ws.root}/`)) return ws;
  }
  throw new Error(`${path} is outside the open folder`);
}

async function readFile(path: string): Promise<File> {
  const ws = workspaceOf(path);
  if (ws.source.kind === "handle") {
    // Read it again from disk, to pick up changes.
    const parts = path.slice(ws.root.length + 1).split("/");
    let dir = ws.source.handle;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return (await dir.getFileHandle(parts[parts.length - 1])).getFile();
  }
  const file = ws.markdown.get(path) ?? ws.images.get(path);
  if (!file) throw new Error(`${path} wasn't found`);
  return file.file;
}

/* ---------- commands ---------- */

const texts = new Map<string, { modified: number; text: string }>();

async function textOf(f: WorkspaceFile): Promise<string> {
  const cached = texts.get(f.path);
  if (cached && cached.modified === f.file.lastModified) return cached.text;
  const text = await f.file.text();
  texts.set(f.path, { modified: f.file.lastModified, text });
  return text;
}

const desktopOnly = () => {
  throw new DesktopOnlyError("This needs the Mido desktop app");
};

/** Saves `blob` as a download named `name`; resolves to the name. */
function download(name: string, blob: Blob): string {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  return name;
}

/** Options of `invoke`: the headers sent with a raw body. */
export interface InvokeOptions {
  headers?: Record<string, string>;
}

export const commands: Record<string, (args: Record<string, unknown>, options?: InvokeOptions) => unknown> = {
  pick_folder: () => pickFolder(),
  async open_folder({ root }) {
    let ws = workspaces.get(root as string);
    if (!ws) {
      const handle = await rememberedFolder(root as string);
      if (!handle) throw new Error(`Choose “${(root as string).slice(1)}” again to open it in this browser.`);
      ws = empty(root as string, { kind: "handle", handle });
      workspaces.set(ws.root, ws);
    }
    if (ws.source.kind === "handle") await ensureReadable(ws.source.handle);
    await reindex(ws);
    current = ws;
    return ws.tree;
  },

  async read_tree() {
    if (!current) throw new Error("No folder is open");
    await reindex(current);
    return current.tree;
  },

  async read_file({ path }) {
    return (await readFile(path as string)).text();
  },

  async search_files({ query, options }) {
    if (!current) throw new Error("No folder is open");
    const docs = [];
    for (const f of current.markdown.values()) docs.push({ path: f.path, text: await textOf(f) });
    // Same order as the sidebar.
    const order = flatten(current.tree);
    docs.sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path));
    return search(docs, query as string, options as SearchOptions);
  },

  /** Comments are shown, not written: only folders read from disk (Chromium) have them. */
  async read_comments({ document: path }) {
    const ws = workspaceOf(path as string);
    if (ws.source.kind !== "handle") return [];
    const parts = [".mido", "comments", ...(path as string).slice(ws.root.length + 1).split("/")];
    let dir = ws.source.handle;
    try {
      for (const part of parts) dir = await dir.getDirectoryHandle(part);
    } catch {
      return [];
    }
    const files = [];
    for await (const thread of dir.values()) {
      if (thread.kind !== "directory" || !/^[A-Za-z0-9]+$/.test(thread.name)) continue;
      for await (const file of thread.values()) {
        const name = /^([A-Za-z0-9]+)\.json$/.exec(file.name)?.[1];
        if (file.kind !== "file" || !name) continue;
        files.push({ thread: thread.name, name, content: await (await file.getFile()).text() });
      }
    }
    return files;
  },

  /** Git needs the desktop app: the web version shows no repository. */
  git_info: () => null,
  git_trust: desktopOnly,
  git_log: desktopOnly,
  git_commit_files: desktopOnly,
  git_file_versions: desktopOnly,
  git_stage: desktopOnly,
  git_unstage: desktopOnly,
  git_commit: desktopOnly,
  git_push: desktopOnly,
  git_pull: desktopOnly,
  git_fetch: desktopOnly,
  git_resolve: desktopOnly,
  git_continue: desktopOnly,
  git_abort: desktopOnly,
  git_discard: desktopOnly,
  git_branches: desktopOnly,
  git_checkout: desktopOnly,
  git_create_branch: desktopOnly,
  git_merge: desktopOnly,
  git_delete_branch: desktopOnly,
  git_outgoing: desktopOnly,
  git_last_message: desktopOnly,

  /** Comments can't be written here, so nobody needs to sign them. */
  git_identity: () => null,

  take_open_requests() {
    const taken = openRequests;
    openRequests = [];
    return taken;
  },

  async export_html({ defaultPath, html }) {
    return download((defaultPath as string).split("/").pop() || "document.html", new Blob([html as string], { type: "text/html" }));
  },

  async export_word(bytes, options) {
    const path = decodeURIComponent(options?.headers?.["x-default-path"] ?? "");
    const type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    return download(path.split("/").pop() || "document.docx", new Blob([bytes as unknown as Uint8Array<ArrayBuffer>], { type }));
  },

  /** No menu bar here. */
  set_terminal_menu: () => {},
  pty_spawn: desktopOnly,
  pty_write: desktopOnly,
  pty_resize: desktopOnly,
  pty_kill: desktopOnly,

  write_file: desktopOnly,
  create_file: desktopOnly,
  create_dir: desktopOnly,
  rename_path: desktopOnly,
  trash_path: desktopOnly,
  save_asset: desktopOnly,
  add_comment_file: desktopOnly,
  compact_comment_thread: desktopOnly,
  app_arch: desktopOnly,
  open_new_window: desktopOnly,
};

function flatten(nodes: Workspace["tree"], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.isDir) flatten(n.children ?? [], out);
    else out.push(n.path);
  }
  return out;
}

/* ---------- images ---------- */

const urls = new Map<string, { file: File; url: string }>();

/** A URL the page can load an image from, for `convertFileSrc`. Synchronous, like Tauri's. */
export function assetUrl(path: string): string {
  let file: File | undefined;
  for (const ws of workspaces.values()) file ??= ws.images.get(path)?.file ?? ws.markdown.get(path)?.file;
  if (!file) return "";
  const cached = urls.get(path);
  if (cached?.file === file) return cached.url;
  if (cached) URL.revokeObjectURL(cached.url);
  const url = URL.createObjectURL(file);
  urls.set(path, { file, url });
  return url;
}

/* ---------- opening folders and files ---------- */

function queueOpen(requests: OpenRequest[]) {
  if (requests.length === 0) return;
  openRequests.push(...requests);
  send("open-requests");
}

/** Lets the visitor pick files with the browser's file input. Resolves to an empty list if cancelled. */
function pickWithInput(directory: boolean): Promise<File[]> {
  return new Promise((done) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (directory) input.webkitdirectory = true;
    else input.accept = ".md,.markdown,.mdown,.mkd,.mdx,text/markdown";
    input.addEventListener("change", () => done([...(input.files ?? [])]));
    input.addEventListener("cancel", () => done([]));
    input.click();
  });
}

/** "Open Folder": resolves to the new folder's root, or null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  if (window.showDirectoryPicker) {
    try {
      const ws = await addHandle(await window.showDirectoryPicker({ id: "mido", mode: "read" }));
      return ws.root;
    } catch (e) {
      if ((e as Error).name === "AbortError") return null;
      throw e;
    }
  }
  const files = await pickWithInput(true);
  if (files.length === 0) return null;
  // "notes/sub/a.md": the first part is the folder's own name.
  const name = files[0].webkitRelativePath.split("/")[0];
  const ws = addSnapshot(
    name,
    files
      .map((file) => ({ rel: file.webkitRelativePath.split("/").slice(1).join("/"), file }))
      .filter((f) => f.rel && isIncluded(f.rel)),
  );
  return ws.root;
}

/** Opens Markdown files on their own, in a folder named after them. */
function openFiles(files: File[]) {
  const markdown = files.filter((f) => MARKDOWN.test(f.name));
  if (markdown.length === 0) return false;
  const name = markdown.length === 1 ? markdown[0].name.replace(MARKDOWN, "") : "Opened files";
  const ws = addSnapshot(name, markdown.map((file) => ({ rel: file.name, file })));
  queueOpen(markdown.map((f) => ({ path: `${ws.root}/${f.name}`, isDir: false })));
  return true;
}

/** "Open Files": picks Markdown files and opens them. */
export async function pickFiles(): Promise<void> {
  openFiles(await pickWithInput(false));
}

interface Dropped {
  handle: Promise<FileSystemHandle | null> | undefined;
  entry: FileSystemEntry | null;
  file: File | null;
}

/**
 * What a drop carries. Must run during the drop event: the items can't be
 * read once it's over, so everything is taken at once, before any await.
 */
function takeDropped(data: DataTransfer): Dropped[] {
  return [...data.items]
    .filter((item) => item.kind === "file")
    .map((item) => ({ handle: item.getAsFileSystemHandle?.(), entry: item.webkitGetAsEntry(), file: item.getAsFile() }));
}

/** Opens folders and files dropped on the page. */
async function openDropped(dropped: Dropped[]): Promise<boolean> {
  const files: File[] = [];
  let opened = false;
  for (const item of dropped) {
    const handle = await item.handle?.catch(() => null);
    if (handle?.kind === "directory") {
      const ws = await addHandle(handle as FileSystemDirectoryHandle);
      queueOpen([{ path: ws.root, isDir: true }]);
      opened = true;
      continue;
    }
    const entry = handle ? null : item.entry;
    if (entry?.isDirectory) {
      const root = newRoot(entry.name);
      const snapshot = await walkEntry(entry as FileSystemDirectoryEntry, root);
      const ws = empty(root, { kind: "snapshot", files: snapshot });
      workspaces.set(root, ws);
      queueOpen([{ path: root, isDir: true }]);
      opened = true;
      continue;
    }
    if (item.file) files.push(item.file);
  }
  return openFiles(files) || opened;
}

/* ---------- page events ---------- */

let refreshing = false;

/** When the visitor comes back to the page, picks up changes made to the open folder meanwhile. */
async function refreshCurrent() {
  if (!current || current.source.kind !== "handle" || refreshing) return;
  refreshing = true;
  try {
    const before = new Map([...current.markdown].map(([p, f]) => [p, f.file.lastModified]));
    await reindex(current);
    const changed = [...current.markdown].filter(([p, f]) => before.get(p) !== f.file.lastModified).map(([p]) => p);
    const removed = [...before.keys()].filter((p) => !current!.markdown.has(p));
    if (changed.length || removed.length) send("fs-changed", [...changed, ...removed]);
  } catch {
    // Permission revoked or folder gone: the next action reports it.
  } finally {
    refreshing = false;
  }
}

export function installPageHandlers() {
  window.addEventListener("focus", refreshCurrent);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshCurrent());

  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
  document.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
    document.body.classList.add("web-dropping");
  });
  document.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) document.body.classList.remove("web-dropping");
  });
  document.addEventListener("drop", (e) => {
    document.body.classList.remove("web-dropping");
    if (!hasFiles(e)) return;
    e.preventDefault();
    openDropped(takeDropped(e.dataTransfer!)).then((opened) => {
      if (!opened) window.dispatchEvent(new CustomEvent("mido:toast", { detail: "Drop a folder or Markdown files to open them." }));
    });
  });
}
