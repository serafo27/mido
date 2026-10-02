import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { EditorView } from "@codemirror/view";
import { api, type FileNode, type OpenRequest } from "./lib/api";
import { basename, dirname, isInside, isMarkdown, join } from "./lib/paths";
import { DOWNLOAD_URL, isMac, isMainWindow, isWeb, requireDesktop, WEB_ACCESS_NEEDED } from "./lib/platform";
import { useStoredState } from "./lib/useStoredState";
import { DEFAULT_SETTINGS, applySettings, lightThemeVariables, type RemoteImages, type Settings } from "./lib/settings";
import { currentMermaidTheme, mermaidTheme, type MermaidTheme } from "./lib/mermaid";
import { currentMarkdownVariables, htmlDocument, renderDocument } from "./lib/exportDocument";
import { assetName, imageMarkdown } from "./lib/images";
import Sidebar from "./components/Sidebar";
import QuickSearch from "./components/QuickSearch";
import DesktopOnly from "./components/DesktopOnly";
import FormatBar from "./components/FormatBar";
import Toolbar, { type ViewMode } from "./components/Toolbar";
import Editor, {
  activeEditor,
  editorLineAt,
  editorScrollTopFor,
  editorSelection,
  editorTopLine,
  forgetEditorState,
  keepCursorInView,
  renameEditorState,
  revealEditorLine,
  revealEditorRange,
  useEditorRemeasure,
} from "./components/Editor";
import Preview, {
  previewAnchor,
  previewLineAt,
  previewScrollTopFor,
  previewTopLine,
  revealPreviewElement,
  revealPreviewLine,
} from "./components/Preview";
import Outline from "./components/Outline";
import Comments, { CommentPeek, type PlacedThread } from "./components/Comments";
import SelectionMenu from "./components/SelectionMenu";
import {
  buildThreads,
  createAnchor,
  lineAt,
  locate,
  serializeEvents,
  trimRange,
  ulid,
  type Anchor,
  type Author,
  type CommentEvent,
  type Thread,
} from "./lib/comments";
import { previewSelection, type SourceHighlight } from "./lib/previewComments";
import TabBar from "./components/TabBar";
import { extractHeadings, headingAt, type Heading } from "./lib/outline";
import { MarkdownParser } from "./lib/blockRenderer";
import StatusBar from "./components/StatusBar";
import SettingsPanel from "./components/SettingsPanel";
import UpdateDialog, { type UpdateState } from "./components/UpdateDialog";
import { CHECK_INTERVAL, checkForUpdates, PREPARE_RESTART, RESTART_READY, type RestartReady } from "./lib/updates";
import { NoFile, Welcome } from "./components/Welcome";
import SourceControl, { diffKey, type DiffTarget } from "./components/SourceControl";
import DiffView from "./components/DiffView";
import BranchPicker from "./components/BranchPicker";
import CommitDialog from "./components/CommitDialog";
import PushDialog from "./components/PushDialog";
import { setLinkShortcutYields } from "./components/Editor";
import type { GitBranch } from "./lib/api";
import { changeLetter, isDocumentPath, useGit } from "./lib/useGit";

interface Tab {
  path: string;
  /** Buffer contents. */
  content: string;
  /** Contents last read from / written to disk. */
  saved: string;
  /** Preview tabs (opened with a single click) get replaced by the next preview. */
  preview: boolean;
  /** Changed on disk while it had unsaved edits, and the user hasn't decided yet: autosave skips it. */
  conflict?: boolean;
}

/** A diff open in a tab. Its key starts with "diff:", so it never clashes with a file's path. */
interface DiffTab {
  key: string;
  target: DiffTarget;
  /** Replaced by the next diff opened with a single click, like a file's preview tab. */
  preview: boolean;
}

const diffTabKey = (target: DiffTarget) => `diff:${diffKey(target)}`;
const isDiffKey = (key: string) => key.startsWith("diff:");

/** What a diff tab is called, as in VS Code: "a.md (Working Tree)". */
function diffTabInfo(target: DiffTarget) {
  const name = basename(target.change.path);
  const details = { unstaged: "(Working Tree)", staged: "(Index)", working: "(HEAD ↔ Working Tree)", conflict: "(Merge Conflict)" };
  const detail = target.kind === "commit" ? `(${target.commit.short})` : details[target.kind];
  return { name, detail, title: `${target.change.path} ${detail}` };
}

/** The fields every comment event has. */
const newEvent = (thread: string, by: Author) => ({ id: ulid(), thread, author: by, at: new Date().toISOString() });
/** Resolving and reopening don't ask for a name when there's no git user yet. */
const UNKNOWN_AUTHOR: Author = { name: "Unknown", email: "" };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const isDirty = (t: Tab) => t.content !== t.saved;

export default function App() {
  // Each window has its own folder and tabs (see `perWindow`).
  const [root, setRoot] = useStoredState<string | null>("mido.root", null, { perWindow: true });
  const [recents, setRecents] = useStoredState<string[]>("mido.recents", [], { shared: true });
  const [storedTabs, setStoredTabs] = useStoredState<string[]>("mido.tabs", [], { perWindow: true });
  const [storedPreviewTab, setStoredPreviewTab] = useStoredState<string | null>("mido.previewTab", null, { perWindow: true });
  const [activePath, setActivePath] = useStoredState<string | null>("mido.active", null, { perWindow: true });
  const [mode, setMode] = useStoredState<ViewMode>("mido.mode", "view");
  const [storedSettings, setStoredSettings] = useStoredState<Partial<Settings>>("mido.settings", {}, { shared: true });
  const [sidebarOpen, setSidebarOpen] = useStoredState("mido.sidebarOpen", true);
  const [sidebarWidth, setSidebarWidth] = useStoredState("mido.sidebarWidth", 268);
  const [splitRatio, setSplitRatio] = useStoredState("mido.splitRatio", 0.5);
  const [outlineOpen, setOutlineOpen] = useStoredState("mido.outlineOpen", false);
  const [commentsOpen, setCommentsOpen] = useStoredState("mido.commentsOpen", false);

  // The source line at the top of the view being left, to show at the top of the next one
  // (0: the view was scrolled to the very top).
  const modeSwitchLine = useRef<number | null>(null);

  /** Read · Split · Edit. The web version only reads: the other two ask for the desktop app. */
  const changeMode = useCallback(
    (next: ViewMode) => {
      if (next !== "view" && requireDesktop("Editing")) return;
      const current = live.current.mode;
      if (next !== current) {
        const preview = previewRef.current;
        const view = activeEditor();
        const scroller = current === "view" ? preview : view?.scrollDOM;
        if (!scroller) modeSwitchLine.current = null;
        else if (atTop(scroller)) modeSwitchLine.current = 0;
        else modeSwitchLine.current = current === "view" ? previewLineAt(preview!) : editorLineAt(view!);
      }
      setMode(next);
    },
    [setMode],
  );
  useEffect(() => {
    if (isWeb && mode !== "view") setMode("view");
  }, []);

  const settings = useMemo<Settings>(() => ({ ...DEFAULT_SETTINGS, ...storedSettings }), [storedSettings]);
  const updateSettings = useCallback(
    (patch: Partial<Settings>) => setStoredSettings((s) => ({ ...s, ...patch })),
    [setStoredSettings],
  );

  const [tree, setTree] = useState<FileNode[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  // Diffs open in tabs next to the files' (see `openDiff`); one of them may be the active tab.
  const [diffTabs, setDiffTabs] = useState<DiffTab[]>([]);
  const [activeDiff, setActiveDiff] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const active = tabs.find((t) => t.path === activePath) ?? null;
  const dirty = active ? isDirty(active) : false;

  // Outline: headings of the active document and the section being read.
  const outlineSource = useDeferredValue(outlineOpen ? (active?.content ?? "") : "");
  // Parsing a chunk at a time, so that only what an edit changed is parsed again.
  const [outlineParser] = useState(() => new MarkdownParser());
  const headings = useMemo(() => extractHeadings(outlineSource, outlineParser), [outlineSource, outlineParser]);
  const [currentLine, setCurrentLine] = useState(1);
  const scrollSpyPausedUntil = useRef(0);
  const trackLine = useCallback((line: number) => {
    if (performance.now() > scrollSpyPausedUntil.current) setCurrentLine(line);
  }, []);
  useEffect(() => setCurrentLine(1), [activePath]);

  const previewRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  // Latest values for async callbacks and event listeners.
  const live = useRef({ tabs, activePath, mode, settings, root });
  live.current = { tabs, activePath, mode, settings, root };
  const liveDiffs = useRef({ diffTabs, activeDiff });
  liveDiffs.current = { diffTabs, activeDiff };
  const activeDiffInfo = useMemo(() => {
    const tab = diffTabs.find((t) => t.key === activeDiff);
    return tab ? diffTabInfo(tab.target) : null;
  }, [diffTabs, activeDiff]);

  /** Activates a file's tab or a diff's. */
  const selectTab = useCallback(
    (key: string) => {
      if (isDiffKey(key)) return setActiveDiff(key);
      setActiveDiff(null);
      setActivePath(key);
    },
    [setActivePath],
  );

  const fail = useCallback((e: unknown) => {
    console.error(e);
    setToast(e instanceof Error ? e.message : String(e));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ---------- tabs & files ---------- */

  // Persist the open tabs (paths only; contents are re-read from disk).
  useEffect(() => {
    const paths = tabs.map((t) => t.path);
    setStoredTabs((prev) => (prev.join("\n") === paths.join("\n") ? prev : paths));
    setStoredPreviewTab(tabs.find((t) => t.preview)?.path ?? null);
  }, [tabs, setStoredTabs, setStoredPreviewTab]);

  // Saves run one at a time, so two saves of the same file can't race each other.
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * Saves the dirty tabs among `paths`. If a file was changed by another app
   * since Mido last read it, asks whether to overwrite it or reload it.
   * Resolves to false if any of them is still unsaved afterwards.
   */
  const saveTabs = useCallback(
    (paths: string[], { auto = false } = {}): Promise<boolean> => {
      const markSaved = (path: string, saved: string, content?: string) =>
        // Synchronously, so the next queued save already sees the new `saved`.
        flushSync(() =>
          setTabs((ts) =>
            ts.map((t) => (t.path === path ? { ...t, saved, content: content ?? t.content, conflict: false } : t)),
          ),
        );

      const saveTab = async (tab: Tab): Promise<boolean> => {
        if ((await api.writeFile(tab.path, tab.content, tab.saved)) === "conflict") {
          const choice = await message(
            `“${basename(tab.path)}” was changed by another app while you were editing it.`,
            {
              title: "Mido",
              kind: "warning",
              buttons: { yes: "Keep My Version", no: "Discard My Changes", cancel: "Cancel" },
            },
          );
          if (choice === "Discard My Changes" || choice === "No") {
            const disk = await api.readFile(tab.path);
            markSaved(tab.path, disk, disk);
            return true;
          }
          if (choice !== "Keep My Version" && choice !== "Yes") {
            setTabs((ts) => ts.map((t) => (t.path === tab.path ? { ...t, conflict: true } : t)));
            return false;
          }
          await api.writeFile(tab.path, tab.content, null);
        }
        // Mark exactly what was written as saved; later keystrokes stay dirty.
        markSaved(tab.path, tab.content);
        return true;
      };

      const run = async () => {
        const targets = live.current.tabs.filter(
          (t) => paths.includes(t.path) && isDirty(t) && !(auto && t.conflict),
        );
        if (targets.length === 0) return true;
        setSaving(true);
        let ok = true;
        try {
          for (const tab of targets) {
            if (!(await saveTab(tab))) ok = false;
          }
        } catch (e) {
          fail(e);
          ok = false;
        } finally {
          setSaving(false);
        }
        return ok;
      };

      const result = saveQueue.current.then(run);
      saveQueue.current = result.catch(() => {});
      return result;
    },
    [fail],
  );

  const saveActive = useCallback(() => {
    const path = live.current.activePath;
    if (path) return saveTabs([path]);
  }, [saveTabs]);

  const saveAll = useCallback(() => saveTabs(live.current.tabs.map((t) => t.path)), [saveTabs]);

  const pinTab = useCallback((path: string) => {
    setTabs((ts) => ts.map((t) => (t.path === path && t.preview ? { ...t, preview: false } : t)));
  }, []);

  /**
   * Opens `path` in a tab. Without `pin` it goes into the single preview tab,
   * replacing whatever was previewed before; with `pin` the tab stays open.
   */
  const openFile = useCallback(
    async (path: string, pin = false) => {
      if (live.current.tabs.some((t) => t.path === path)) {
        if (pin) pinTab(path);
        setActiveDiff(null);
        setActivePath(path);
        return;
      }
      try {
        const text = await api.readFile(path);
        const tab: Tab = { path, content: text, saved: text, preview: !pin };
        const replaced = pin ? undefined : live.current.tabs.find((t) => t.preview);
        if (replaced) forgetEditorState(replaced.path);
        setTabs((ts) => {
          if (ts.some((t) => t.path === path)) return ts;
          const next = [...ts];
          const previewIndex = replaced ? ts.findIndex((t) => t.path === replaced.path) : -1;
          if (previewIndex >= 0) {
            next[previewIndex] = tab;
          } else {
            const at = ts.findIndex((t) => t.path === live.current.activePath);
            next.splice(at < 0 ? ts.length : at + 1, 0, tab);
          }
          return next;
        });
        setActiveDiff(null);
        setActivePath(path);
      } catch (e) {
        fail(e);
      }
    },
    [fail, pinTab, setActivePath],
  );

  const pinFile = useCallback((path: string) => openFile(path, true), [openFile]);

  const removeTabs = useCallback(
    (predicate: (path: string) => boolean) => {
      const { tabs, activePath } = live.current;
      const remaining = tabs.filter((t) => !predicate(t.path));
      tabs.filter((t) => predicate(t.path)).forEach((t) => forgetEditorState(t.path));
      setTabs(remaining);
      if (activePath && predicate(activePath)) {
        // Activate the neighbour, like browsers do.
        const index = tabs.findIndex((t) => t.path === activePath);
        const neighbour = remaining[Math.min(index, remaining.length - 1)];
        setActivePath(neighbour?.path ?? null);
      }
    },
    [setActivePath],
  );

  const closeTab = useCallback(
    async (path: string) => {
      const tab = live.current.tabs.find((t) => t.path === path);
      if (!tab) return;
      if (isDirty(tab)) {
        if (live.current.settings.autosave) {
          if (!(await saveTabs([path]))) return;
        } else {
          const choice = await message(`Do you want to save the changes made to “${basename(path)}”?`, {
            title: "Mido",
            kind: "warning",
            buttons: { yes: "Save", no: "Don’t Save", cancel: "Cancel" },
          });
          if (choice === "Cancel") return;
          if ((choice === "Save" || choice === "Yes") && !(await saveTabs([path]))) return;
        }
      }
      removeTabs((p) => p === path);
    },
    [saveTabs, removeTabs],
  );

  const moveTab = useCallback((from: number, to: number) => {
    setTabs((ts) => {
      const next = [...ts];
      const [tab] = next.splice(from, 1);
      next.splice(to, 0, tab);
      return next;
    });
  }, []);

  const cycleTab = useCallback(
    (delta: number) => {
      const { tabs, activePath } = live.current;
      const { diffTabs, activeDiff } = liveDiffs.current;
      const keys = [...tabs.map((t) => t.path), ...diffTabs.map((t) => t.key)];
      if (keys.length < 2) return;
      const i = keys.indexOf(activeDiff ?? activePath ?? "");
      selectTab(keys[(i + delta + keys.length) % keys.length]);
    },
    [],
  );

  /** Saves images added in the editor next to the document; returns the Markdown linking them. */
  const addImages = useCallback(
    async (docPath: string, files: File[]) => {
      const links: string[] = [];
      for (const file of files) {
        try {
          links.push(imageMarkdown(await api.saveAsset(docPath, file, assetName(file.name))));
        } catch (e) {
          fail(e);
        }
      }
      return links.length ? links.join("\n") : null;
    },
    [fail],
  );

  // Editing a preview tab pins it, so edits never vanish with a replaced preview.
  const updateContent = useCallback((path: string, value: string) => {
    setTabs((ts) =>
      ts.map((t) => (t.path === path && t.content !== value ? { ...t, content: value, preview: false } : t)),
    );
  }, []);

  const refreshTree = useCallback(async () => {
    if (!root) return;
    try {
      setTree(await api.readTree());
    } catch (e) {
      fail(e);
    }
  }, [root, fail]);

  /** Resolves to false if the folder wasn't switched (dialog cancelled, or a file couldn't be saved). */
  const openFolder = useCallback(
    async (path?: string) => {
      const dir = path ?? (await api.pickFolder());
      if (typeof dir !== "string") return false;
      if (!(await saveAll())) return false;
      removeTabs(() => true);
      setActivePath(null);
      setRoot(dir);
      setRecents((r) => [dir, ...r.filter((x) => x !== dir)].slice(0, 8));
      return true;
    },
    [saveAll, removeTabs, setActivePath, setRoot, setRecents],
  );

  /* ---------- files opened from the Finder, the Dock or the command line ---------- */

  // The folder the backend has open: `root` once `open_folder` has succeeded for it.
  const openedRoot = useRef<string | null>(null);
  const openRequests = useRef<OpenRequest[]>([]);
  const handlingRequests = useRef(false);

  /**
   * Opens what the system asked for, in order. A file inside the open folder
   * opens in a tab; otherwise its folder becomes the workspace first, and this
   * runs again once that folder is open.
   */
  const handleOpenRequests = useCallback(async () => {
    if (handlingRequests.current) return;
    handlingRequests.current = true;
    try {
      while (openRequests.current.length > 0) {
        const opened = openedRoot.current;
        // A folder is still opening: this runs again once it's ready.
        if (!opened && live.current.root) return;
        const request = openRequests.current[0];
        if (!request.isDir && opened && isInside(opened, request.path)) {
          openRequests.current.shift();
          await openFile(request.path, true);
        } else if (request.isDir && request.path === opened) {
          openRequests.current.shift();
        } else {
          // A file stays queued, to open once its folder is ready.
          if (request.isDir) openRequests.current.shift();
          openedRoot.current = null;
          if (!(await openFolder(request.isDir ? request.path : dirname(request.path)))) {
            openedRoot.current = opened;
            openRequests.current = [];
          }
          return;
        }
      }
    } finally {
      handlingRequests.current = false;
    }
  }, [openFile, openFolder]);

  useEffect(() => {
    const take = async () => {
      openRequests.current.push(...(await api.takeOpenRequests()));
      handleOpenRequests();
    };
    const unlisten = getCurrentWindow().listen("open-requests", take);
    // Also take the requests that came before the listener, e.g. the file that launched Mido.
    unlisten.then(take);
    return () => {
      unlisten.then((f) => f());
    };
  }, [handleOpenRequests]);

  // Restores the tabs from the previous session, once the folder is open
  // (Mido can only read files inside it).
  const tabsRestored = useRef(false);
  const restoreTabs = useCallback(async () => {
    if (tabsRestored.current) return;
    tabsRestored.current = true;
    const loaded = await Promise.all(
      storedTabs.map((path) =>
        api.readFile(path).then(
          (text): Tab => ({ path, content: text, saved: text, preview: path === storedPreviewTab }),
          () => null,
        ),
      ),
    );
    const restored = loaded.filter((t): t is Tab => t !== null);
    setTabs(restored);
    const current = live.current.activePath;
    if (!restored.some((t) => t.path === current)) setActivePath(restored[0]?.path ?? null);
    // Only the stored values from startup matter.
  }, []);

  // Open the workspace (and start watching it) whenever the root changes.
  useEffect(() => {
    openedRoot.current = null;
    if (!root) {
      setTree([]);
      tabsRestored.current = true;
      handleOpenRequests();
      return;
    }
    let cancelled = false;
    api
      .openFolder(root)
      .then(async (nodes) => {
        if (cancelled) return;
        setTree(nodes);
        await restoreTabs();
        if (cancelled) return;
        openedRoot.current = root;
        handleOpenRequests();
      })
      .catch((e) => {
        if (cancelled) return;
        fail(e);
        // Don't retry opening what's in a folder that can't be opened.
        openRequests.current = openRequests.current.filter((r) => !isInside(root, r.path));
        // In the web version a remembered folder only needs a click to be readable again.
        if (!(isWeb && String(e).includes(WEB_ACCESS_NEEDED))) setRecents((r) => r.filter((x) => x !== root));
        setRoot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [root, fail, setRoot, setRecents, restoreTabs, handleOpenRequests]);

  // React to changes made outside the app.
  useEffect(() => {
    let timer: number | undefined;
    const unlisten = getCurrentWindow().listen<string[]>("fs-changed", async ({ payload }) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refreshTree, 120);

      const affected = live.current.tabs.filter((t) => payload.includes(t.path));
      for (const tab of affected) {
        try {
          const disk = await api.readFile(tab.path);
          // Reload only tabs without local edits, so nothing is lost.
          setTabs((ts) =>
            ts.map((t) => (t.path === tab.path && !isDirty(t) && t.saved !== disk ? { ...t, content: disk, saved: disk } : t)),
          );
        } catch {
          // Deleted or moved: keep the buffer open so the user can still save it.
        }
      }
    });
    return () => {
      window.clearTimeout(timer);
      unlisten.then((f) => f());
    };
  }, [refreshTree]);

  const anyDirty = tabs.some(isDirty);
  useEffect(() => {
    if (!settings.autosave || !anyDirty) return;
    const t = setTimeout(() => saveTabs(live.current.tabs.map((t) => t.path), { auto: true }), 700);
    return () => clearTimeout(t);
  }, [tabs, settings.autosave, anyDirty, saveTabs]);

  // Never lose edits when the window closes.
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      const dirtyTabs = live.current.tabs.filter(isDirty);
      if (dirtyTabs.length === 0) return;
      const shouldSave = await ask(
        dirtyTabs.length === 1
          ? `Save changes to “${basename(dirtyTabs[0].path)}” before closing?`
          : `Save changes to ${dirtyTabs.length} files before closing?`,
        { title: "Mido", kind: "warning", okLabel: "Save", cancelLabel: "Don’t Save" },
      );
      // Keep the window open if something couldn't be saved.
      if (shouldSave && !(await saveAll())) event.preventDefault();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [saveAll]);

  useEffect(() => {
    const title = activeDiffInfo
      ? `${activeDiffInfo.name} ${activeDiffInfo.detail} — Mido`
      : activePath
        ? `${basename(activePath)}${dirty ? " •" : ""} — Mido`
        : "Mido";
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [activePath, dirty, activeDiffInfo]);

  /* ---------- comments ---------- */

  // The threads of the active document, read from `.mido/comments`.
  const [threads, setThreads] = useState<{ path: string | null; list: Thread[] }>({ path: null, list: [] });
  const [activeThread, setActiveThread] = useState<string | null>(null);
  // Text picked for a new comment, until its first message is sent.
  const [draft, setDraft] = useState<{ path: string; anchor: Anchor } | null>(null);
  // The git user of the open folder: undefined until known, null if there's none.
  const [gitAuthor, setGitAuthor] = useState<Author | null | undefined>(undefined);
  const author = useMemo<Author | null>(
    () => gitAuthor ?? (settings.commentAuthor ? { name: settings.commentAuthor, email: "" } : null),
    [gitAuthor, settings.commentAuthor],
  );

  const loadComments = useCallback(async () => {
    const path = live.current.activePath;
    if (!path) return setThreads({ path: null, list: [] });
    let list: Thread[] = [];
    try {
      list = buildThreads(await api.readComments(path));
    } catch {
      // No folder open yet, or a file outside it: no comments.
    }
    if (live.current.activePath === path) setThreads({ path, list });
  }, []);

  // `tree` changes once the folder is open, which is when comments can be read.
  useEffect(() => {
    loadComments();
  }, [activePath, tree, loadComments]);
  useEffect(() => setActiveThread(null), [activePath]);
  // A thread is open only while the panel shows it.
  useEffect(() => {
    if (!commentsOpen) setActiveThread(null);
  }, [commentsOpen]);

  useEffect(() => {
    const unlisten = getCurrentWindow().listen("comments-changed", loadComments);
    return () => {
      unlisten.then((f) => f());
    };
  }, [loadComments]);

  useEffect(() => {
    setGitAuthor(undefined);
    if (!root || tree.length === 0) return;
    let cancelled = false;
    api.gitIdentity().then(
      (identity) => !cancelled && setGitAuthor(identity),
      () => !cancelled && setGitAuthor(null),
    );
    return () => {
      cancelled = true;
    };
    // Once per folder: `tree` only tells when it's open.
  }, [root, tree.length > 0]);

  const activeContent = active?.content ?? "";
  const placedThreads = useMemo<PlacedThread[]>(() => {
    if (threads.path !== activePath) return [];
    const placed = threads.list.map((thread) => ({ thread, range: locate(activeContent, thread.anchor) }));
    return placed.sort(
      (a, b) =>
        (a.range?.from ?? Infinity) - (b.range?.from ?? Infinity) || (a.thread.id < b.thread.id ? -1 : 1),
    );
  }, [threads, activePath, activeContent]);

  // The thread under the mouse: in the document (with where the mouse came onto
  // it, for the peek card) or in the panel (without).
  const [hover, setHover] = useState<{ id: string; x?: number; y?: number } | null>(null);
  const hoverHighlight = useCallback((id: string | null, x?: number, y?: number) => {
    // Only a change of thread updates the state, not every mouse move.
    setHover((prev) => (prev?.id === id && (prev.x === undefined) === (x === undefined) ? prev : id ? { id, x, y } : null));
  }, []);
  useEffect(() => setHover(null), [activePath, mode]);

  const draftRange = draft && draft.path === activePath ? locate(activeContent, draft.anchor) : null;
  const highlights = useMemo<SourceHighlight[]>(() => {
    const list: SourceHighlight[] = placedThreads.flatMap(({ thread, range }) =>
      range && !thread.resolved
        ? [
            {
              id: thread.id,
              ...range,
              // Filled in only while it's open in the panel.
              active: commentsOpen && thread.id === activeThread && !draftRange,
              hovered: thread.id === hover?.id,
            },
          ]
        : [],
    );
    if (draftRange) list.push({ id: "draft", ...draftRange, active: true });
    return list;
  }, [placedThreads, commentsOpen, activeThread, hover?.id, draftRange?.from, draftRange?.to]);
  const peekThread =
    hover?.x !== undefined && hover.id !== activeThread
      ? placedThreads.find((t) => t.thread.id === hover.id)?.thread
      : undefined;
  const openThreadCount = placedThreads.filter((t) => !t.thread.resolved).length;

  /** Starts a comment on the text selected in the editor or the preview. */
  const startComment = useCallback(() => {
    if (requireDesktop("Commenting")) return;
    const tab = live.current.tabs.find((t) => t.path === live.current.activePath);
    if (!tab) return;
    const { mode } = live.current;
    let range = mode !== "view" ? editorSelection() : null;
    if (!range && mode !== "edit" && previewRef.current) range = previewSelection(previewRef.current, tab.content);
    range = range && trimRange(tab.content, range);
    if (!range || range.from === range.to) {
      setToast("Select the text you want to comment on.");
      return;
    }
    setCommentsOpen(true);
    setActiveThread(null);
    setDraft({ path: tab.path, anchor: createAnchor(tab.content, range) });
  }, [setCommentsOpen]);

  /** The author of a new comment; `name` when they had to type one, which is remembered. */
  const signer = useCallback(
    (name?: string): Author | null => {
      if (!name) return author;
      updateSettings({ commentAuthor: name });
      return { name, email: "" };
    },
    [author, updateSettings],
  );

  const addEvent = useCallback(
    async (path: string, event: CommentEvent) => {
      try {
        await api.addCommentFile(path, event.thread, event.id, serializeEvents([event]));
      } catch (e) {
        fail(e);
      }
      await loadComments();
    },
    [fail, loadComments],
  );

  const submitDraft = useCallback(
    async (body: string, name?: string) => {
      const by = signer(name);
      if (!draft || !by) return;
      const id = ulid();
      await addEvent(draft.path, { ...newEvent(id, by), id, type: "create", body, anchor: draft.anchor });
      // Back to reading: the new thread shows lightly, like the others.
      setDraft(null);
      setActiveThread(null);
    },
    [draft, signer, addEvent],
  );

  const replyToThread = useCallback(
    (thread: string, body: string, name?: string) => {
      const by = signer(name);
      if (by && activePath) addEvent(activePath, { ...newEvent(thread, by), type: "reply", body });
    },
    [signer, activePath, addEvent],
  );

  const reopenThread = useCallback(
    (thread: string) => {
      if (activePath) addEvent(activePath, { ...newEvent(thread, author ?? UNKNOWN_AUTHOR), type: "reopen" });
    },
    [author, activePath, addEvent],
  );

  const deleteComment = useCallback(
    (thread: string, target: string) => {
      if (author && activePath) addEvent(activePath, { ...newEvent(thread, author), type: "delete", target });
    },
    [author, activePath, addEvent],
  );

  /** Resolving gathers the thread's events into one file, replacing the ones they were in. */
  const resolveThread = useCallback(
    async (id: string) => {
      const thread = threads.list.find((t) => t.id === id);
      const path = threads.path;
      const by = author ?? UNKNOWN_AUTHOR;
      if (!thread || !path) return;
      const event: CommentEvent = { ...newEvent(id, by), type: "resolve" };
      try {
        await api.compactCommentThread(path, id, event.id, serializeEvents([...thread.events, event]), thread.files);
      } catch (e) {
        fail(e);
      }
      if (activeThread === id) setActiveThread(null);
      await loadComments();
    },
    [threads, author, activeThread, fail, loadComments],
  );

  /** Shows a thread's text: from the panel, scrolls the document to it. */
  const selectThread = useCallback(
    (id: string) => {
      setActiveThread(id);
      setDraft(null);
      const range = placedThreads.find((t) => t.thread.id === id)?.range;
      if (!range) return;
      if (live.current.mode === "view") {
        if (previewRef.current) revealPreviewLine(previewRef.current, lineAt(activeContent, range.from));
      } else {
        revealEditorRange(range.from, range.to);
      }
    },
    [placedThreads, activeContent],
  );

  /** A highlight was clicked in the document: show its thread. Clicking elsewhere lets it go. */
  const showThread = useCallback(
    (id: string | null) => {
      if (id === "draft") return;
      setActiveThread(id);
      if (id) setCommentsOpen(true);
    },
    [setCommentsOpen],
  );

  /* ---------- tree operations ---------- */

  const createEntry = useCallback(
    async (parent: string, name: string, kind: "file" | "folder") => {
      if (requireDesktop(kind === "file" ? "Creating files" : "Creating folders")) return;
      const path = join(parent, kind === "file" && !isMarkdown(name) ? `${name}.md` : name);
      try {
        if (kind === "file") await api.createFile(path);
        else await api.createDir(path);
        await refreshTree();
        if (kind === "file") {
          await openFile(path, true);
          if (live.current.mode === "view") setMode("split");
        }
      } catch (e) {
        fail(e);
      }
    },
    [refreshTree, openFile, fail, setMode],
  );

  const renameEntry = useCallback(
    async (path: string, newName: string, isDir: boolean) => {
      if (requireDesktop("Renaming")) return;
      const name = !isDir && !newName.includes(".") ? `${newName}.md` : newName;
      const to = join(dirname(path), name);
      const moved = (p: string) => (isInside(path, p) ? to + p.slice(path.length) : p);
      try {
        const inside = live.current.tabs.filter((t) => isInside(path, t.path)).map((t) => t.path);
        if (!(await saveTabs(inside))) return;
        await api.renamePath(path, to);
        renameEditorState(path, to);
        setTabs((ts) => ts.map((t) => ({ ...t, path: moved(t.path) })));
        const current = live.current.activePath;
        if (current) setActivePath(moved(current));
        await refreshTree();
      } catch (e) {
        fail(e);
      }
    },
    [saveTabs, refreshTree, fail, setActivePath],
  );

  const trashEntry = useCallback(
    async (path: string) => {
      if (requireDesktop("Moving files to the Trash")) return;
      const confirmed = await ask(`Move “${basename(path)}” to the Trash?`, {
        title: "Mido",
        kind: "warning",
        okLabel: "Move to Trash",
        cancelLabel: "Cancel",
      });
      if (!confirmed) return;
      try {
        await api.trashPath(path);
        removeTabs((p) => isInside(path, p));
        await refreshTree();
      } catch (e) {
        fail(e);
      }
    },
    [refreshTree, removeTabs, fail],
  );

  /* ---------- settings & layout ---------- */

  const toggleWrap = useCallback(
    () => setStoredSettings((s) => ({ ...s, wrap: !(s.wrap ?? DEFAULT_SETTINGS.wrap) })),
    [setStoredSettings],
  );

  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => applySettings(settings, systemDark), [settings, systemDark]);

  useEditorRemeasure([settings.codeFont, settings.customCodeFont, settings.editorFontSize]);

  // Native "Settings…" menu item (macOS).
  useEffect(() => {
    const unlisten = getCurrentWindow().listen("menu-settings", () => setSettingsOpen((o) => !o));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  /* ---------- git ---------- */

  // Only ever reads on its own: every git action below is a click away.
  const git = useGit(root, tree);
  const gitStatus = git.repo?.trusted ? git.repo.status : null;
  const [gitOpen, setGitOpenState] = useState(false);
  const gitOpenRef = useRef(gitOpen);
  gitOpenRef.current = gitOpen;
  const gitShortcutsRef = useRef(false);
  const [gitError, setGitError] = useState<string | null>(null);
  // One commit message, in the panel and in the commit dialog.
  const [commitMessage, setCommitMessage] = useState("");
  const [gitDialog, setGitDialog] = useState<"commit" | "push" | "branches" | null>(null);
  useEffect(() => {
    setDiffTabs([]);
    setActiveDiff(null);
    setGitError(null);
  }, [root]);

  /** Opens a diff in a tab: a preview tab with a single click, one that stays with `pin`. */
  const openDiff = useCallback((target: DiffTarget, pin = false) => {
    const key = diffTabKey(target);
    setDiffTabs((ts) => {
      if (ts.some((t) => t.key === key)) return pin ? ts.map((t) => (t.key === key ? { ...t, preview: false } : t)) : ts;
      const tab = { key, target, preview: !pin };
      const preview = ts.findIndex((t) => t.preview);
      if (preview >= 0) return ts.map((t, i) => (i === preview ? tab : t));
      return [...ts, tab];
    });
    setActiveDiff(key);
  }, []);

  const closeDiff = useCallback(
    (key: string) => {
      const { tabs, activePath } = live.current;
      const { diffTabs, activeDiff } = liveDiffs.current;
      setDiffTabs((ts) => ts.filter((t) => t.key !== key));
      if (activeDiff !== key) return;
      // Activate the neighbour, like closing a file's tab does.
      const keys = [...tabs.map((t) => t.path), ...diffTabs.map((t) => t.key)];
      const index = keys.indexOf(key);
      const remaining = keys.filter((k) => k !== key);
      const neighbour = remaining[Math.min(index, remaining.length - 1)];
      if (neighbour && isDiffKey(neighbour)) setActiveDiff(neighbour);
      else {
        setActiveDiff(null);
        if (neighbour) setActivePath(neighbour);
        else if (activePath) setActivePath(activePath);
      }
    },
    [setActivePath],
  );

  /** Swaps a diff tab's target (staging a file turns its working tree diff into the index's). */
  const retargetDiffs = useCallback((change: (t: DiffTarget) => DiffTarget | null) => {
    const renamed = new Map<string, string>();
    setDiffTabs((ts) =>
      ts.map((tab) => {
        const target = change(tab.target);
        if (!target) return tab;
        const key = diffTabKey(target);
        renamed.set(tab.key, key);
        return { ...tab, key, target };
      }),
    );
    setActiveDiff((a) => (a && renamed.has(a) ? renamed.get(a)! : a));
  }, []);
  // The search panel and the source control panel take the tree's place in turn.
  const setGitOpen = useCallback((open: boolean) => {
    setGitOpenState(open);
    if (open) setSearchOpen(false);
  }, []);
  const changeSearchOpen = useCallback((open: boolean) => {
    setSearchOpen(open);
    if (open) setGitOpenState(false);
  }, []);

  // What the panel lists: Markdown documents (and conflicts), unless every file is asked for.
  const gitChangeCount = useMemo(
    () =>
      (gitStatus?.files ?? []).filter((f) => f.conflicted || settings.gitShowAllFiles || isDocumentPath(f.path)).length,
    [gitStatus, settings.gitShowAllFiles],
  );
  const gitBadges = useMemo(
    () => new Map((gitStatus?.files ?? []).filter((f) => f.local).map((f) => [f.local!, changeLetter(f)])),
    [gitStatus],
  );
  const unsavedPaths = useMemo(() => new Set(tabs.filter(isDirty).map((t) => t.path)), [tabs]);
  // Changes whenever the repository does, so an open diff loads both sides again.
  const gitVersion = useMemo(() => JSON.stringify(gitStatus), [gitStatus]);

  /** Runs a git action; its error stays in the panel, where there's room to read it. */
  const gitAction = useCallback(
    async (label: string, action: () => Promise<unknown>): Promise<boolean> => {
      setGitError(null);
      try {
        await git.run(label, action);
        return true;
      } catch (e) {
        setGitError(String(e));
        setGitOpen(true);
        return false;
      }
    },
    [git, setGitOpen],
  );

  const trustRepo = useCallback(() => {
    api.gitTrust().then(git.refresh, fail);
  }, [git.refresh, fail]);

  // Staging a file being compared shows its other side, which now holds the change.
  const stage = useCallback(
    async (paths: string[]) => {
      if (!(await gitAction("Staging…", () => api.gitStage(paths)))) return;
      retargetDiffs((d) =>
        d.kind === "unstaged" && paths.includes(d.change.path)
          ? { kind: "staged", change: { ...d.change, staged: d.change.unstaged === "?" ? "A" : d.change.unstaged, unstaged: null } }
          : null,
      );
    },
    [gitAction, retargetDiffs],
  );
  const unstage = useCallback(
    async (paths: string[]) => {
      if (!(await gitAction("Unstaging…", () => api.gitUnstage(paths)))) return;
      retargetDiffs((d) =>
        d.kind === "staged" && paths.includes(d.change.path)
          ? { kind: "unstaged", change: { ...d.change, unstaged: d.change.staged === "A" ? "?" : d.change.staged, staged: null } }
          : null,
      );
    },
    [gitAction, retargetDiffs],
  );

  const commit = useCallback(
    async (message: string) => {
      const done = await gitAction("Committing…", () => api.gitCommit(message));
      if (done) setCommitMessage("");
      return done;
    },
    [gitAction],
  );

  const discard = useCallback(
    async (paths: string[]) => {
      const files = gitStatus?.files.filter((f) => paths.includes(f.path)) ?? [];
      const untracked = files.filter((f) => f.unstaged === "?").length;
      const what = paths.length === 1 ? `“${basename(paths[0])}”` : `${paths.length} files`;
      const sure = await ask(
        `Discard the changes in ${what}? They aren't staged, so they'll be lost.${untracked ? ` New files go to the Trash.` : ""}`,
        { title: "Discard Changes", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" },
      );
      if (!sure) return;
      if (await gitAction("Discarding…", () => api.gitDiscard(paths))) {
        for (const tab of liveDiffs.current.diffTabs) {
          if (tab.target.kind === "unstaged" && paths.includes(tab.target.change.path)) closeDiff(tab.key);
        }
      }
    },
    [gitStatus, gitAction, closeDiff],
  );

  const checkout = useCallback(
    (branch: GitBranch) => gitAction(`Switching to ${branch.name}…`, () => api.gitCheckout(branch.name, branch.remote)),
    [gitAction],
  );
  const createBranch = useCallback(
    (name: string) => gitAction(`Creating ${name}…`, () => api.gitCreateBranch(name)),
    [gitAction],
  );
  const mergeBranch = useCallback(
    async (branch: GitBranch) => {
      const into = gitStatus?.branch ?? "the current branch";
      const sure = await ask(`Merge ${branch.name} into ${into}? If both changed the same lines, you'll resolve the conflicts here.`, {
        title: "Merge Branch",
        kind: "info",
        okLabel: "Merge",
        cancelLabel: "Cancel",
      });
      if (sure) await gitAction(`Merging ${branch.name}…`, () => api.gitMerge(branch.name));
    },
    [gitStatus, gitAction],
  );
  const deleteBranch = useCallback(
    async (branch: GitBranch) => {
      const sure = await ask(`Delete the branch ${branch.name}? Git refuses if it has commits merged nowhere else.`, {
        title: "Delete Branch",
        kind: "warning",
        okLabel: "Delete",
        cancelLabel: "Cancel",
      });
      if (sure) await gitAction(`Deleting ${branch.name}…`, () => api.gitDeleteBranch(branch.name));
    },
    [gitAction],
  );

  const pushFromDialog = useCallback(
    (remote: string | null) => gitAction(remote ? "Publishing…" : "Pushing…", () => api.gitPush(remote)),
    [gitAction],
  );
  const commitFromDialog = useCallback(
    async (thenPush: boolean) => {
      const done = await commit(commitMessage);
      if (done && thenPush) setGitDialog("push");
      return done;
    },
    [commit, commitMessage],
  );

  // ⌘K belongs to the commit dialog in a repository Mido may use git in, as in IntelliJ;
  // the editor's link shortcut steps aside (⌥⌘K still inserts a link).
  const gitShortcuts = gitStatus !== null;
  gitShortcutsRef.current = gitShortcuts;
  useEffect(() => {
    setLinkShortcutYields(gitShortcuts);
    return () => setLinkShortcutYields(false);
  }, [gitShortcuts]);

  const fetchRemote = useCallback(() => gitAction("Fetching…", api.gitFetch), [gitAction]);

  const pull = useCallback(async () => {
    const from = gitStatus?.upstream ?? "the remote";
    const choice = await message(
      `How should the commits from ${from} be combined with yours?\n\nMerge adds a merge commit when both sides have new commits. Rebase replays your commits on top of theirs.`,
      { title: "Pull", kind: "info", buttons: { yes: "Merge", no: "Rebase", cancel: "Cancel" } },
    );
    const mode = choice === "Merge" || choice === "Yes" ? "merge" : choice === "Rebase" || choice === "No" ? "rebase" : null;
    if (!mode) return;
    await gitAction(mode === "merge" ? "Pulling (merge)…" : "Pulling (rebase)…", () => api.gitPull(mode));
  }, [gitStatus, gitAction]);

  const push = useCallback(async () => {
    if (!gitStatus) return;
    if (gitStatus.upstream) {
      await gitAction("Pushing…", () => api.gitPush());
      return;
    }
    const remote = gitStatus.remotes.includes("origin") ? "origin" : gitStatus.remotes[0];
    if (!remote) return;
    const publish = await ask(`“${gitStatus.branch}” isn't on ${remote} yet. Publish it there and push to it from now on?`, {
      title: "Publish Branch",
      kind: "info",
      okLabel: "Publish",
      cancelLabel: "Cancel",
    });
    if (publish) await gitAction("Publishing…", () => api.gitPush(remote));
  }, [gitStatus, gitAction]);

  const continueOperation = useCallback(() => gitAction("Continuing…", api.gitContinue), [gitAction]);

  const abortOperation = useCallback(async () => {
    const what = gitStatus?.operation === "rebase" ? "rebase" : "merge";
    const sure = await ask(`Abort the ${what}? The files go back to how they were before it, and conflicts you resolved are lost.`, {
      title: "Mido",
      kind: "warning",
      okLabel: `Abort ${what === "rebase" ? "Rebase" : "Merge"}`,
      cancelLabel: "Cancel",
    });
    if (sure && (await gitAction("Aborting…", api.gitAbort))) {
      for (const tab of liveDiffs.current.diffTabs) if (tab.target.kind === "conflict") closeDiff(tab.key);
    }
  }, [gitStatus, gitAction, closeDiff]);

  const resolveConflict = useCallback(
    async (path: string, content: string) => {
      const done = await gitAction("Marking as resolved…", () => api.gitResolve(path, content));
      if (done) closeDiff(diffTabKey({ kind: "conflict", change: { path } as DiffTarget["change"] }));
      return done;
    },
    [gitAction, closeDiff],
  );

  const activeDiffTab = diffTabs.find((t) => t.key === activeDiff) ?? null;

  const tabInfos = useMemo(
    () => [
      ...tabs.map((t) => ({ path: t.path, dirty: isDirty(t), preview: t.preview })),
      ...diffTabs.map((t) => ({ path: t.key, dirty: false, preview: t.preview, diff: diffTabInfo(t.target) })),
    ],
    [tabs, diffTabs],
  );
  const activeTabKey = activeDiff ?? activePath;
  const pinAnyTab = useCallback(
    (key: string) => {
      if (isDiffKey(key)) setDiffTabs((ts) => ts.map((t) => (t.key === key ? { ...t, preview: false } : t)));
      else pinTab(key);
    },
    [pinTab],
  );
  const closeAnyTab = useCallback((key: string) => (isDiffKey(key) ? closeDiff(key) : closeTab(key)), [closeDiff, closeTab]);
  // Files and diffs each keep their own order: a tab only moves among its kind.
  const moveAnyTab = useCallback(
    (from: number, to: number) => {
      const files = live.current.tabs.length;
      if (from < files && to < files) moveTab(from, to);
      else if (from >= files && to >= files)
        setDiffTabs((ts) => {
          const next = [...ts];
          const [tab] = next.splice(from - files, 1);
          next.splice(to - files, 0, tab);
          return next;
        });
    },
    [moveTab],
  );


  /* ---------- updates ---------- */

  const [update, setUpdate] = useState<UpdateState | null>(null);
  // Bumped whenever the dialog closes, so a check still in flight can't reopen it.
  const checkRun = useRef(0);
  // Automatic checks offer each version once per session; manual checks always show it.
  const offeredVersion = useRef<string | null>(null);

  const runUpdateCheck = useCallback(async (manual: boolean) => {
    const run = ++checkRun.current;
    if (manual) setUpdate({ kind: "checking" });
    try {
      const result = await checkForUpdates();
      if (run !== checkRun.current) return;
      if (result.status === "available") {
        if (!manual && offeredVersion.current === result.version) return;
        offeredVersion.current = result.version;
        setUpdate({ kind: "available", info: result });
      } else if (manual) {
        setUpdate({ kind: "up-to-date", currentVersion: result.currentVersion });
      }
    } catch (e) {
      if (run !== checkRun.current) return;
      // Automatic checks fail silently (e.g. offline); only manual ones report errors.
      if (manual) setUpdate({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const closeUpdate = useCallback(() => {
    checkRun.current++;
    setUpdate(null);
  }, []);

  useEffect(() => {
    // The web version is always the latest: it's served with the website.
    // Other windows leave it to the main one, so an update is offered once.
    if (isWeb || !isMainWindow || !settings.checkForUpdates) return;
    const first = window.setTimeout(() => runUpdateCheck(false), 4000);
    const periodic = window.setInterval(() => runUpdateCheck(false), CHECK_INTERVAL);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(periodic);
    };
  }, [settings.checkForUpdates, runUpdateCheck]);

  // Before restarting into an update, every window saves its edits.
  useEffect(() => {
    const unlisten = getCurrentWindow().listen(PREPARE_RESTART, async () => {
      const saved = await saveAll().catch(() => false);
      const reply: RestartReady = { label: getCurrentWindow().label, saved };
      emit(RESTART_READY, reply);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [saveAll]);

  // "Check for Updates…" in the macOS app menu.
  useEffect(() => {
    const unlisten = getCurrentWindow().listen("menu-check-updates", () => runUpdateCheck(true));
    return () => {
      unlisten.then((f) => f());
    };
  }, [runUpdateCheck]);

  /* ---------- web version ---------- */

  // What the visitor tried that needs the desktop app, if anything.
  const [desktopFeature, setDesktopFeature] = useState<string | null>(null);
  useEffect(() => {
    if (!isWeb) return;
    const onDesktopOnly = (e: Event) => setDesktopFeature((e as CustomEvent<string>).detail);
    const onToast = (e: Event) => setToast((e as CustomEvent<string>).detail);
    window.addEventListener("mido:desktop-only", onDesktopOnly);
    window.addEventListener("mido:toast", onToast);
    return () => {
      window.removeEventListener("mido:desktop-only", onDesktopOnly);
      window.removeEventListener("mido:toast", onToast);
    };
  }, []);

  /* ---------- export & print ---------- */

  const renderTab = useCallback(
    (tab: Tab, options: { mermaid: MermaidTheme; embedImages: boolean; remoteImages?: RemoteImages }) =>
      renderDocument({
        source: tab.content,
        filePath: tab.path,
        root: live.current.root ?? dirname(tab.path),
        showFrontmatter: live.current.settings.showFrontmatter,
        assetUrl: (path) => convertFileSrc(path),
        ...options,
      }),
    [],
  );

  const activeTab = () => live.current.tabs.find((t) => t.path === live.current.activePath);

  const exportHtml = useCallback(async () => {
    const tab = activeTab();
    if (!tab) return;
    try {
      const { settings } = live.current;
      const dark = document.documentElement.dataset.theme === "dark";
      const body = await renderTab(tab, { mermaid: currentMermaidTheme(), embedImages: true });
      const html = htmlDocument({
        title: basename(tab.path).replace(/\.[^.]+$/, ""),
        body,
        theme: dark ? "dark" : "light",
        style: settings.style,
        variables: currentMarkdownVariables(body),
        wrap: settings.wrap,
        justify: settings.justify,
      });
      const saved = await api.exportHtml(tab.path.replace(/\.[^./\\]+$/, "") + ".html", html);
      if (saved) setToast(`Exported to ${basename(saved)}`);
    } catch (e) {
      fail(e);
    }
  }, [renderTab, fail]);

  const placedRef = useRef(placedThreads);
  placedRef.current = placedThreads;

  const exportWord = useCallback(async () => {
    const tab = activeTab();
    if (!tab) return;
    try {
      const { settings, root } = live.current;
      // Paper is light: code, alerts and diagrams take the light theme's colours.
      const variables = lightThemeVariables(settings);
      const { wordDocument } = await import("./lib/exportWord");
      const doc = await wordDocument({
        source: tab.content,
        filePath: tab.path,
        root: root ?? dirname(tab.path),
        title: basename(tab.path).replace(/\.[^.]+$/, ""),
        showFrontmatter: settings.showFrontmatter,
        assetUrl: (path) => convertFileSrc(path),
        remoteImages: settings.remoteImages,
        variables,
        mermaid: mermaidTheme((name) => variables[name] ?? "", false),
        threads: tab.path === live.current.activePath ? placedRef.current : [],
      });
      const saved = await api.exportWord(tab.path.replace(/\.[^./\\]+$/, "") + ".docx", doc);
      if (saved) setToast(`Exported to ${basename(saved)}`);
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  // The document being printed, rendered apart from the app (which print CSS hides).
  const [printBody, setPrintBody] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const printVariables = useMemo(() => lightThemeVariables(settings) as CSSProperties, [settings]);

  const printDocument = useCallback(async () => {
    const tab = activeTab();
    if (!tab) return;
    try {
      // Paper is light: diagrams take the light theme's colours, like the page.
      const light = lightThemeVariables(live.current.settings);
      const mermaid = mermaidTheme((name) => light[name] ?? "", false);
      const body = await renderTab(tab, { mermaid, embedImages: false, remoteImages: live.current.settings.remoteImages });
      flushSync(() => setPrintBody(body));
      await imagesLoaded(printRef.current);
      // On macOS Tauri routes this to WebKit's native print panel, which also saves PDFs.
      await window.print();
    } catch (e) {
      fail(e);
    }
  }, [renderTab, fail]);

  // "Export as HTML…", "Export as Word…" and "Print…" in the File menu (macOS).
  useEffect(() => {
    const unlisteners = [
      getCurrentWindow().listen("menu-export-html", exportHtml),
      getCurrentWindow().listen("menu-export-word", exportWord),
      getCurrentWindow().listen("menu-print", printDocument),
    ];
    return () => {
      for (const u of unlisteners) u.then((f) => f());
    };
  }, [exportHtml, exportWord, printDocument]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.code === "KeyZ" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggleWrap();
        return;
      }
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      // Source control: ⌃⇧G, as in VS Code.
      if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && e.code === "KeyG" && git.repo) {
        e.preventDefault();
        setSidebarOpen(true);
        setGitOpen(!gitOpenRef.current);
        return;
      }
      const mod = isMac ? e.metaKey : e.ctrlKey;
      // Commit (⌘K) and push (⌘⇧K) dialogs, as in IntelliJ.
      if (mod && !e.altKey && e.code === "KeyK" && gitShortcutsRef.current) {
        e.preventDefault();
        setGitDialog(e.shiftKey ? "push" : "commit");
        return;
      }
      // On the desktop, Print is a menu item; the web version has no menu.
      if (isWeb && mod && e.altKey && e.code === "KeyP") {
        e.preventDefault();
        printDocument();
        return;
      }
      if (isWeb && mod && e.altKey && !e.shiftKey && e.code === "KeyE") {
        e.preventDefault();
        exportWord();
        return;
      }
      if (mod && e.altKey && !e.shiftKey && e.code === "KeyM") {
        e.preventDefault();
        startComment();
        return;
      }
      if (!mod || e.altKey) return;
      if (e.shiftKey) {
        // On macOS, New Window is a menu item.
        if (!isMac && !isWeb && e.code === "KeyN") {
          e.preventDefault();
          api.openNewWindow().catch(fail);
        } else if (e.code === "KeyO") {
          e.preventDefault();
          setOutlineOpen((o) => !o);
        } else if (e.code === "KeyM") {
          e.preventDefault();
          setCommentsOpen((o) => !o);
        } else if (e.code === "KeyE") {
          e.preventDefault();
          exportHtml();
        } else if (e.code === "KeyF") {
          e.preventDefault();
          setSidebarOpen(true);
          changeSearchOpen(true);
          // Already showing: the panel only focuses itself when it appears.
          requestAnimationFrame(() => window.dispatchEvent(new Event("mido:focus-search")));
        } else if (e.code === "BracketRight" || e.code === "BracketLeft") {
          e.preventDefault();
          cycleTab(e.code === "BracketRight" ? 1 : -1);
        }
        return;
      }
      const actions: Record<string, () => void> = {
        s: saveActive,
        o: () => openFolder(),
        w: () => {
          const key = liveDiffs.current.activeDiff ?? live.current.activePath;
          if (key) closeAnyTab(key);
        },
        p: () => setQuickSearchOpen((open) => !open),
        ",": () => setSettingsOpen((o) => !o),
        "\\": () => setSidebarOpen((o) => !o),
        "1": () => changeMode("view"),
        "2": () => changeMode("split"),
        "3": () => changeMode("edit"),
      };
      const action = actions[e.key.toLowerCase()];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveActive, openFolder, closeAnyTab, cycleTab, toggleWrap, setSidebarOpen, setOutlineOpen, setCommentsOpen, startComment, changeMode, exportHtml, exportWord, printDocument, fail, git.repo, setGitOpen]);

  const dragResize = (e: ReactPointerEvent<HTMLDivElement>, onMove: (ev: PointerEvent) => void) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    const up = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", up);
  };

  const onEditorScroll = useCallback(
    (view: EditorView) => {
      trackLine(editorTopLine(view));
      // Not while it settles after following the preview: its own adjustments would pull the preview back.
      if (live.current.mode !== "split" || isOwnScroll(view.scrollDOM) || settling.has(view)) return;
      const preview = previewRef.current;
      if (preview) syncPreview(view, preview);
    },
    [trackLine],
  );

  const onPreviewScroll = useCallback(
    (el: HTMLElement) => {
      const { mode } = live.current;
      if (mode === "view") trackLine(previewTopLine(el));
      // In split mode the editor follows the preview too, as in VS Code.
      if (mode !== "split" || isOwnScroll(el)) return;
      const view = activeEditor();
      if (view) syncEditor(el, view);
    },
    [trackLine],
  );

  // After switching views, show the line that was at the top of the last one.
  useEffect(() => {
    const line = modeSwitchLine.current;
    modeSwitchLine.current = null;
    if (line === null) return;
    // In a frame, after a newly shown editor has restored its own scroll position.
    const frame = requestAnimationFrame(() => {
      const view = activeEditor();
      const preview = previewRef.current;
      if (mode !== "view" && view) {
        if (line === 0) setScrollTop(view.scrollDOM, 0);
        else scrollEditorToLine(view, line);
        keepCursorInView(view);
        if (mode === "split" && preview) syncPreview(view, preview);
      } else if (mode === "view" && preview) {
        setScrollTop(preview, line === 0 ? 0 : previewScrollTopFor(preview, line));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  const goToHeading = useCallback((heading: Heading) => {
    // Hold the highlight on the clicked heading while the view scrolls to it
    // (the last sections may never reach the top of the pane).
    scrollSpyPausedUntil.current = performance.now() + 700;
    setCurrentLine(heading.line);
    const preview = previewRef.current;
    if (live.current.mode === "view") {
      if (preview) revealPreviewLine(preview, heading.line);
    } else {
      // In split mode the preview follows the editor through scroll sync.
      revealEditorLine(heading.line);
    }
  }, []);

  // A search result, or a link's `#fragment`, to scroll to once its file is showing.
  const pendingReveal = useRef<{ path: string; line: number } | { path: string; anchor: string } | null>(null);
  const [revealRequest, setRevealRequest] = useState(0);

  const openMatch = useCallback(
    async (path: string, line: number) => {
      pendingReveal.current = { path, line };
      await openFile(path);
      setRevealRequest((n) => n + 1);
    },
    [openFile],
  );

  const openLink = useCallback(
    async (path: string, anchor?: string) => {
      pendingReveal.current = anchor ? { path, anchor } : null;
      await openFile(path);
      if (anchor) setRevealRequest((n) => n + 1);
    },
    [openFile],
  );

  useEffect(() => {
    const target = pendingReveal.current;
    if (!target || target.path !== activePath) return;
    let frame = 0;
    let attempts = 0;
    const reveal = () => {
      const preview = previewRef.current;
      const view = live.current.mode === "view";
      // The preview of a file that just opened may not have rendered yet.
      // A link's fragment is looked up there, in split mode too.
      if ((view || "anchor" in target) && !preview?.querySelector("[data-line]")) {
        if (attempts++ < 30) frame = requestAnimationFrame(reveal);
        return;
      }
      pendingReveal.current = null;
      if ("anchor" in target) {
        // A fragment the page doesn't have leaves it at the top, as in a browser.
        // In split mode the editor follows the preview through scroll sync.
        const anchor = previewAnchor(preview!, target.anchor);
        if (anchor) revealPreviewElement(preview!, anchor);
      } else if (view) {
        revealPreviewLine(preview!, target.line);
      } else {
        // In split mode the preview follows the editor through scroll sync.
        revealEditorLine(target.line);
      }
    };
    frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, [activePath, revealRequest]);

  /* ---------- render ---------- */

  const overlays = (
    <>
      {gitDialog === "branches" && gitStatus && (
        <BranchPicker
          onClose={() => setGitDialog(null)}
          onCheckout={checkout}
          onCreate={createBranch}
          onMerge={mergeBranch}
          onDelete={deleteBranch}
        />
      )}
      {gitDialog === "commit" && gitStatus && (
        <CommitDialog
          status={gitStatus}
          busy={git.busy}
          version={gitVersion}
          message={commitMessage}
          onMessageChange={setCommitMessage}
          unsaved={unsavedPaths}
          onStage={stage}
          onUnstage={unstage}
          onDiscard={discard}
          onCommit={commitFromDialog}
          onOpenDiff={(target, pin) => {
            setGitDialog(null);
            openDiff(target, pin);
          }}
          onOpenFile={openFile}
          onClose={() => setGitDialog(null)}
          showAll={settings.gitShowAllFiles}
        />
      )}
      {gitDialog === "push" && gitStatus && (
        <PushDialog
          status={gitStatus}
          busy={git.busy}
          onPush={pushFromDialog}
          onOpenDiff={openDiff}
          onClose={() => setGitDialog(null)}
        />
      )}
      {desktopFeature && <DesktopOnly feature={desktopFeature} onClose={() => setDesktopFeature(null)} />}
      {isWeb && <WebNarrowNotice />}
      {quickSearchOpen && root && (
        <QuickSearch
          root={root}
          tree={tree}
          openPaths={tabs.map((t) => t.path)}
          onOpenFile={openFile}
          onOpenMatch={openMatch}
          onClose={() => setQuickSearchOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          systemDark={systemDark}
          onChange={updateSettings}
          onCheckForUpdates={() => runUpdateCheck(true)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {update && (
        <UpdateDialog
          state={update}
          notificationsEnabled={settings.checkForUpdates}
          onNotificationsChange={(checkForUpdates) => updateSettings({ checkForUpdates })}
          onRetry={() => runUpdateCheck(true)}
          onClose={closeUpdate}
        />
      )}
    </>
  );

  const toolbar = (
    <Toolbar
      showSidebarToggle={root !== null}
      sidebarOpen={root !== null && sidebarOpen}
      root={root}
      activePath={active && !activeDiffTab ? active.path : null}
      dirty={dirty}
      mode={mode}
      wrap={settings.wrap}
      settingsOpen={settingsOpen}
      outlineOpen={outlineOpen}
      commentsOpen={commentsOpen}
      commentCount={openThreadCount}
      tabs={root && !settings.showPathBar && tabInfos.length > 0 ? tabInfos : undefined}
      activeTab={activeTabKey}
      onSelectTab={selectTab}
      onPinTab={pinAnyTab}
      onCloseTab={closeAnyTab}
      onMoveTab={moveAnyTab}
      onToggleOutline={() => setOutlineOpen((o) => !o)}
      onToggleComments={() => setCommentsOpen((o) => !o)}
      onMode={changeMode}
      onExport={isWeb ? exportHtml : undefined}
      onExportWord={isWeb ? exportWord : undefined}
      onPrint={isWeb ? printDocument : undefined}
      onWrap={toggleWrap}
      onToggleSidebar={() => setSidebarOpen((o) => !o)}
      onToggleSettings={() => setSettingsOpen((o) => !o)}
    />
  );

  if (!root) {
    return (
      <div className="app">
        <main className="main">
          {toolbar}
          <Welcome recents={recents} onOpen={openFolder} />
        </main>
        {overlays}
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  return (
    <>
      <div className="app">
        {sidebarOpen && (
          <>
            <Sidebar
              root={root}
              tree={tree}
              activePath={activePath}
              width={sidebarWidth}
              onOpenFile={openFile}
              onPinFile={pinFile}
              recents={recents}
              onOpenFolder={openFolder}
              onNewWindow={() => api.openNewWindow().catch(fail)}
              onRefresh={refreshTree}
              onCreate={createEntry}
              onRename={renameEntry}
              onTrash={trashEntry}
              onReveal={(p) => revealItemInDir(p).catch(fail)}
              searchOpen={searchOpen}
              onSearchOpenChange={changeSearchOpen}
              onOpenMatch={openMatch}
              gitOpen={gitOpen && git.repo !== null}
              onGitOpenChange={setGitOpen}
              gitChanges={gitChangeCount}
              gitBadges={gitBadges}
              gitPanel={
                git.repo && (
                  <SourceControl
                    visible
                    repo={git.repo}
                    busy={git.busy}
                    unsaved={unsavedPaths}
                    activeDiff={activeDiffTab && diffKey(activeDiffTab.target)}
                    error={gitError}
                    onDismissError={() => setGitError(null)}
                    onTrust={trustRepo}
                    message={commitMessage}
                    onMessageChange={setCommitMessage}
                    onDiscard={discard}
                    onOpenBranches={() => setGitDialog("branches")}
                    onOpenCommitDialog={() => setGitDialog("commit")}
                    onOpenPushDialog={() => setGitDialog("push")}
                    showAll={settings.gitShowAllFiles}
                    onShowAll={() => updateSettings({ gitShowAllFiles: true })}
                    onStage={stage}
                    onUnstage={unstage}
                    onCommit={commit}
                    onFetch={fetchRemote}
                    onPull={pull}
                    onPush={push}
                    onContinue={continueOperation}
                    onAbort={abortOperation}
                    onOpenDiff={openDiff}
                    onOpenFile={openFile}
                  />
                )
              }
            />
            <div
              className="resizer sidebar-resizer"
              onPointerDown={(e) => dragResize(e, (ev) => setSidebarWidth(clamp(ev.clientX, 180, 520)))}
            />
          </>
        )}
        <main className="main">
          {toolbar}
          {settings.showPathBar && tabInfos.length > 0 && (
            <TabBar
              tabs={tabInfos}
              activePath={activeTabKey}
              onSelect={selectTab}
              onPin={pinAnyTab}
              onClose={closeAnyTab}
              onMove={moveAnyTab}
            />
          )}
          {activeDiffTab ? (
            <DiffView
              key={activeDiffTab.key}
              target={activeDiffTab.target}
              version={gitVersion}
              busy={git.busy !== null}
              onOpenFile={openFile}
              onStage={stage}
              onUnstage={unstage}
              onResolve={resolveConflict}
            />
          ) : active ? (
            <>
              {mode === "edit" && settings.formatBar && <FormatBar />}
              <div className="content-row">
                <div
                  ref={workspaceRef}
                  className={`workspace mode-${mode}`}
                  style={{ gridTemplateColumns: mode === "split" ? `${splitRatio}fr 1px ${1 - splitRatio}fr` : "1fr" }}
                >
                  {mode !== "view" && (
                    <Editor
                      key="editor"
                      docKey={active.path}
                      value={active.content}
                      wrap={settings.wrap}
                      onChange={updateContent}
                      onScroll={onEditorScroll}
                      onAddImages={addImages}
                      highlights={highlights}
                      onSelectHighlight={showThread}
                      onHoverHighlight={hoverHighlight}
                      minimap={settings.minimap}
                    />
                  )}
                  {mode === "split" && (
                    <div
                      key="split-resizer"
                      className="resizer split-resizer"
                      onPointerDown={(e) =>
                        dragResize(e, (ev) => {
                          const rect = workspaceRef.current!.getBoundingClientRect();
                          setSplitRatio(clamp((ev.clientX - rect.left) / rect.width, 0.2, 0.8));
                        })
                      }
                    />
                  )}
                  {mode !== "edit" && (
                    <Preview
                      key={`preview:${active.path}`}
                      content={active.content}
                      filePath={active.path}
                      root={root}
                      wrap={settings.wrap}
                      justify={settings.justify}
                      showFrontmatter={settings.showFrontmatter}
                      scrollRef={previewRef}
                      onScroll={onPreviewScroll}
                      onOpenFile={openLink}
                      highlights={highlights}
                      onSelectHighlight={showThread}
                      onHoverHighlight={hoverHighlight}
                      minimap={settings.minimap}
                      remoteImages={settings.remoteImages}
                    />
                  )}
                </div>
                {peekThread && hover?.x !== undefined && hover.y !== undefined && (
                  <CommentPeek thread={peekThread} x={hover.x} y={hover.y} />
                )}
                {!isWeb && <SelectionMenu containerRef={workspaceRef} onComment={startComment} />}
                {outlineOpen && (
                  <Outline
                    headings={headings}
                    activeIndex={headingAt(headings, currentLine)}
                    onSelect={goToHeading}
                    onClose={() => setOutlineOpen(false)}
                  />
                )}
                {commentsOpen && (
                  <Comments
                    threads={placedThreads}
                    activeId={activeThread}
                    draft={draft && draft.path === active.path ? { quote: draft.anchor.exact } : null}
                    author={author}
                    readOnly={isWeb}
                    onSelect={selectThread}
                    onHover={hoverHighlight}
                    onNewComment={startComment}
                    onSubmitDraft={submitDraft}
                    onCancelDraft={() => setDraft(null)}
                    onReply={replyToThread}
                    onResolve={resolveThread}
                    onReopen={reopenThread}
                    onDelete={deleteComment}
                    onClose={() => setCommentsOpen(false)}
                  />
                )}
              </div>
              <StatusBar
                content={active.content}
                dirty={dirty}
                saving={saving}
                wrap={settings.wrap}
                autosave={settings.autosave}
                onWrap={toggleWrap}
                onAutosave={() => updateSettings({ autosave: !settings.autosave })}
                git={
                  gitStatus && {
                    branch: gitStatus.branch,
                    ahead: gitStatus.ahead,
                    behind: gitStatus.behind,
                    changes: gitChangeCount,
                    onClick: () => setGitDialog("branches"),
                  }
                }
              />
            </>
          ) : (
            <NoFile />
          )}
        </main>
        {overlays}
        {toast && (
          <div className="toast" onClick={() => setToast(null)}>
            {toast}
          </div>
        )}
      </div>
      {printBody !== null && (
        <div className="print-view" ref={printRef} style={printVariables}>
          {/* Rendered by renderDocument: sanitized like the preview. */}
          <article
            className={`markdown wrap ${settings.justify ? "justify" : ""}`}
            dangerouslySetInnerHTML={{ __html: printBody }}
          />
        </div>
      )}
    </>
  );
}

/** Resolves once the images in `el` have loaded or failed, or after `timeout` ms. */
function imagesLoaded(el: HTMLElement | null, timeout = 3000): Promise<unknown> {
  const pending = [...(el?.querySelectorAll("img") ?? [])]
    .filter((img) => !img.complete)
    .map(
      (img) =>
        new Promise((done) => {
          img.addEventListener("load", done);
          img.addEventListener("error", done);
        }),
    );
  return Promise.race([Promise.all(pending), new Promise((done) => setTimeout(done, timeout))]);
}

/** Scroll positions the app set itself: the scroll event each causes isn't the user's. */
const ownScrolls = new WeakMap<HTMLElement, { top: number; at: number }>();

function setScrollTop(el: HTMLElement, top: number) {
  el.scrollTop = top;
  ownScrolls.set(el, { top: el.scrollTop, at: performance.now() });
}

/**
 * Whether this scroll event is the one a `setScrollTop` caused. It's matched
 * once, and soon: setting a position the element already had causes none,
 * and the user may scroll there later.
 */
function isOwnScroll(el: HTMLElement): boolean {
  const own = ownScrolls.get(el);
  ownScrolls.delete(el);
  return !!own && Math.abs(el.scrollTop - own.top) < 1 && performance.now() - own.at < 300;
}

const atTop = (el: HTMLElement) => el.scrollTop <= 1;
const atBottom = (el: HTMLElement) => el.scrollTop + el.clientHeight >= el.scrollHeight - 4;

/**
 * Scroll sync, both ways as in VS Code: the source line at the top of one
 * side, with its fraction, goes to the top of the other. Blocks in the
 * preview carry their source line, and positions between them are
 * interpolated.
 */
function syncPreview(view: EditorView, preview: HTMLElement) {
  const scroller = view.scrollDOM;
  if (atTop(scroller)) setScrollTop(preview, 0);
  else if (atBottom(scroller)) setScrollTop(preview, preview.scrollHeight);
  else setScrollTop(preview, previewScrollTopFor(preview, editorLineAt(view)));
}

function syncEditor(preview: HTMLElement, view: EditorView) {
  const scroller = view.scrollDOM;
  if (atTop(preview)) setScrollTop(scroller, 0);
  else if (atBottom(preview)) setScrollTop(scroller, scroller.scrollHeight);
  else scrollEditorToLine(view, previewLineAt(preview));
}

/** Ends the editor's settling after a jump (see `scrollEditorToLine`). */
const settling = new WeakMap<EditorView, () => void>();
const USER_SCROLLS = ["wheel", "pointerdown", "keydown", "touchstart"] as const;

/**
 * Puts `line` at the top of the editor. The editor estimates the height of
 * lines it hasn't drawn, and keeps what's in view still as it measures them,
 * so the jump is repeated for a few frames, until the user takes over.
 */
function scrollEditorToLine(view: EditorView, line: number) {
  const scroller = view.scrollDOM;
  const place = () => setScrollTop(scroller, editorScrollTopFor(view, line));
  settling.get(view)?.();
  place();
  let frame = 0;
  let frames = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    for (const type of USER_SCROLLS) scroller.removeEventListener(type, stop);
    settling.delete(view);
  };
  const again = () => {
    place();
    if (++frames < 4) frame = requestAnimationFrame(again);
    else stop();
  };
  for (const type of USER_SCROLLS) scroller.addEventListener(type, stop, { passive: true });
  frame = requestAnimationFrame(again);
  settling.set(view, stop);
}

/** The web version needs a desktop-sized window; on a phone, point to the app instead. */
function WebNarrowNotice() {
  return (
    <div className="web-narrow-notice">
      <h2>Mido needs a bigger screen</h2>
      <p>Open this page on a computer to read your Markdown files, or get Mido for Mac.</p>
      <a className="primary-button" href={DOWNLOAD_URL}>
        Get Mido for Mac
      </a>
    </div>
  );
}
