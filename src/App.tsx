import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import { ask, message, open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { EditorView } from "@codemirror/view";
import { api, type FileNode, type OpenRequest } from "./lib/api";
import { basename, dirname, isInside, isMarkdown, join } from "./lib/paths";
import { isMac } from "./lib/platform";
import { useStoredState } from "./lib/useStoredState";
import { DEFAULT_SETTINGS, applySettings, type Settings } from "./lib/settings";
import Sidebar from "./components/Sidebar";
import Toolbar, { type ViewMode } from "./components/Toolbar";
import Editor, {
  editorTopLine,
  forgetEditorState,
  renameEditorState,
  revealEditorLine,
  useEditorRemeasure,
} from "./components/Editor";
import Preview, { previewTopLine, revealPreviewLine } from "./components/Preview";
import Outline from "./components/Outline";
import TabBar from "./components/TabBar";
import { extractHeadings, headingAt, type Heading } from "./lib/outline";
import StatusBar from "./components/StatusBar";
import SettingsPanel from "./components/SettingsPanel";
import UpdateDialog, { type UpdateState } from "./components/UpdateDialog";
import { CHECK_INTERVAL, checkForUpdates } from "./lib/updates";
import { NoFile, Welcome } from "./components/Welcome";

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

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const isDirty = (t: Tab) => t.content !== t.saved;

export default function App() {
  const [root, setRoot] = useStoredState<string | null>("mido.root", null);
  const [recents, setRecents] = useStoredState<string[]>("mido.recents", []);
  const [storedTabs, setStoredTabs] = useStoredState<string[]>("mido.tabs", []);
  const [storedPreviewTab, setStoredPreviewTab] = useStoredState<string | null>("mido.previewTab", null);
  const [activePath, setActivePath] = useStoredState<string | null>("mido.active", null);
  const [mode, setMode] = useStoredState<ViewMode>("mido.mode", "view");
  const [storedSettings, setStoredSettings] = useStoredState<Partial<Settings>>("mido.settings", {});
  const [sidebarOpen, setSidebarOpen] = useStoredState("mido.sidebarOpen", true);
  const [sidebarWidth, setSidebarWidth] = useStoredState("mido.sidebarWidth", 268);
  const [splitRatio, setSplitRatio] = useStoredState("mido.splitRatio", 0.5);
  const [outlineOpen, setOutlineOpen] = useStoredState("mido.outlineOpen", false);

  const settings = useMemo<Settings>(() => ({ ...DEFAULT_SETTINGS, ...storedSettings }), [storedSettings]);
  const updateSettings = useCallback(
    (patch: Partial<Settings>) => setStoredSettings((s) => ({ ...s, ...patch })),
    [setStoredSettings],
  );

  const [tree, setTree] = useState<FileNode[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const active = tabs.find((t) => t.path === activePath) ?? null;
  const dirty = active ? isDirty(active) : false;

  // Outline: headings of the active document and the section being read.
  const outlineSource = useDeferredValue(outlineOpen ? (active?.content ?? "") : "");
  const headings = useMemo(() => extractHeadings(outlineSource), [outlineSource]);
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

  const fail = useCallback((e: unknown) => {
    console.error(e);
    setToast(String(e));
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
      if (tabs.length < 2) return;
      const i = tabs.findIndex((t) => t.path === activePath);
      setActivePath(tabs[(i + delta + tabs.length) % tabs.length].path);
    },
    [setActivePath],
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
      const dir = path ?? (await openDialog({ directory: true, multiple: false, title: "Open Folder" }));
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
    const unlisten = listen("open-requests", take);
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
        setRecents((r) => r.filter((x) => x !== root));
        setRoot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [root, fail, setRoot, setRecents, restoreTabs, handleOpenRequests]);

  // React to changes made outside the app.
  useEffect(() => {
    let timer: number | undefined;
    const unlisten = listen<string[]>("fs-changed", async ({ payload }) => {
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
    const title = activePath ? `${basename(activePath)}${dirty ? " •" : ""} — Mido` : "Mido";
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [activePath, dirty]);

  /* ---------- tree operations ---------- */

  const createEntry = useCallback(
    async (parent: string, name: string, kind: "file" | "folder") => {
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
    const unlisten = listen("menu-settings", () => setSettingsOpen((o) => !o));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

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
    if (!settings.checkForUpdates) return;
    const first = window.setTimeout(() => runUpdateCheck(false), 4000);
    const periodic = window.setInterval(() => runUpdateCheck(false), CHECK_INTERVAL);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(periodic);
    };
  }, [settings.checkForUpdates, runUpdateCheck]);

  // "Check for Updates…" in the macOS app menu.
  useEffect(() => {
    const unlisten = listen("menu-check-updates", () => runUpdateCheck(true));
    return () => {
      unlisten.then((f) => f());
    };
  }, [runUpdateCheck]);

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
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey) return;
      if (e.shiftKey) {
        if (e.code === "KeyO") {
          e.preventDefault();
          setOutlineOpen((o) => !o);
        } else if (e.code === "KeyF") {
          e.preventDefault();
          setSidebarOpen(true);
          setSearchOpen(true);
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
        w: () => live.current.activePath && closeTab(live.current.activePath),
        p: () => {
          setSidebarOpen(true);
          setSearchOpen(false);
          requestAnimationFrame(() => window.dispatchEvent(new Event("mido:focus-filter")));
        },
        ",": () => setSettingsOpen((o) => !o),
        "\\": () => setSidebarOpen((o) => !o),
        "1": () => setMode("view"),
        "2": () => setMode("split"),
        "3": () => setMode("edit"),
      };
      const action = actions[e.key.toLowerCase()];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveActive, openFolder, closeTab, cycleTab, toggleWrap, setSidebarOpen, setOutlineOpen, setMode]);

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
      if (live.current.mode !== "split") return;
      const preview = previewRef.current;
      if (preview) syncScroll(view, preview);
    },
    [trackLine],
  );

  const onPreviewScroll = useCallback(
    (el: HTMLElement) => {
      if (live.current.mode === "view") trackLine(previewTopLine(el));
    },
    [trackLine],
  );

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

  // A search result to scroll to once its file is showing.
  const pendingReveal = useRef<{ path: string; line: number } | null>(null);
  const [revealRequest, setRevealRequest] = useState(0);

  const openMatch = useCallback(
    async (path: string, line: number) => {
      pendingReveal.current = { path, line };
      await openFile(path);
      setRevealRequest((n) => n + 1);
    },
    [openFile],
  );

  useEffect(() => {
    const target = pendingReveal.current;
    if (!target || target.path !== activePath) return;
    let frame = 0;
    let attempts = 0;
    const reveal = () => {
      if (live.current.mode === "view") {
        const preview = previewRef.current;
        // The preview of a file that just opened may not have rendered yet.
        if (!preview?.querySelector("[data-line]")) {
          if (attempts++ < 30) frame = requestAnimationFrame(reveal);
          return;
        }
        revealPreviewLine(preview, target.line);
      } else {
        // In split mode the preview follows the editor through scroll sync.
        revealEditorLine(target.line);
      }
      pendingReveal.current = null;
    };
    frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, [activePath, revealRequest]);

  /* ---------- render ---------- */

  const tabInfos = useMemo(
    () => tabs.map((t) => ({ path: t.path, dirty: isDirty(t), preview: t.preview })),
    [tabs],
  );

  const overlays = (
    <>
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
      activePath={active ? active.path : null}
      dirty={dirty}
      mode={mode}
      wrap={settings.wrap}
      settingsOpen={settingsOpen}
      outlineOpen={outlineOpen}
      tabs={root && !settings.showPathBar && tabs.length > 0 ? tabInfos : undefined}
      onSelectTab={setActivePath}
      onPinTab={pinTab}
      onCloseTab={closeTab}
      onMoveTab={moveTab}
      onToggleOutline={() => setOutlineOpen((o) => !o)}
      onMode={setMode}
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
            onOpenFolder={() => openFolder()}
            onRefresh={refreshTree}
            onCreate={createEntry}
            onRename={renameEntry}
            onTrash={trashEntry}
            onReveal={(p) => revealItemInDir(p).catch(fail)}
            searchOpen={searchOpen}
            onSearchOpenChange={setSearchOpen}
            onOpenMatch={openMatch}
          />
          <div
            className="resizer sidebar-resizer"
            onPointerDown={(e) => dragResize(e, (ev) => setSidebarWidth(clamp(ev.clientX, 180, 520)))}
          />
        </>
      )}
      <main className="main">
        {toolbar}
        {settings.showPathBar && tabs.length > 0 && (
          <TabBar
            tabs={tabInfos}
            activePath={activePath}
            onSelect={setActivePath}
            onPin={pinTab}
            onClose={closeTab}
            onMove={moveTab}
          />
        )}
        {active ? (
          <>
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
                    onOpenFile={openFile}
                  />
                )}
              </div>
              {outlineOpen && (
                <Outline
                  headings={headings}
                  activeIndex={headingAt(headings, currentLine)}
                  onSelect={goToHeading}
                  onClose={() => setOutlineOpen(false)}
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
  );
}

/**
 * Aligns the preview with the editor using the source line numbers that
 * `rehypeSourceLines` stamps on each top-level block.
 */
function syncScroll(view: EditorView, preview: HTMLElement) {
  const scroller = view.scrollDOM;
  if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
    preview.scrollTop = preview.scrollHeight;
    return;
  }
  const block = view.lineBlockAtHeight(scroller.scrollTop);
  const line = view.state.doc.lineAt(block.from).number;
  const progress = line + (scroller.scrollTop - block.top) / Math.max(1, block.height);

  const blocks = preview.querySelectorAll<HTMLElement>("[data-line]");
  if (blocks.length === 0) return;
  const base = preview.getBoundingClientRect().top - preview.scrollTop;
  const top = (el: HTMLElement) => el.getBoundingClientRect().top - base;

  let prev: HTMLElement | null = null;
  let next: HTMLElement | null = null;
  for (const el of blocks) {
    if (Number(el.dataset.line) <= progress) prev = el;
    else {
      next = el;
      break;
    }
  }
  if (!prev) {
    preview.scrollTop = 0;
    return;
  }
  const prevLine = Number(prev.dataset.line);
  const nextLine = next ? Number(next.dataset.line) : view.state.doc.lines + 1;
  const prevTop = top(prev);
  const nextTop = next ? top(next) : prevTop + prev.offsetHeight;
  const ratio = (progress - prevLine) / Math.max(1, nextLine - prevLine);
  preview.scrollTop = prevTop + (nextTop - prevTop) * ratio - 40;
}
