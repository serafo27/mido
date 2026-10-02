import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Pencil,
  RefreshCw,
  Search,
  Trash,
  X,
} from "lucide-react";
import type { FileNode } from "../lib/api";
import { basename, dirname, isInside } from "../lib/paths";
import { isMac, isWeb, macWindowInset, requireDesktop } from "../lib/platform";
import { useStoredState } from "../lib/useStoredState";
import SearchPanel from "./SearchPanel";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import { WebBrand } from "./Welcome";

type Pending =
  | { kind: "new-file" | "new-folder"; parent: string }
  | { kind: "rename"; path: string; isDir: boolean };

interface MenuState {
  x: number;
  y: number;
  node: FileNode | null;
}

interface SidebarProps {
  root: string;
  tree: FileNode[];
  activePath: string | null;
  width: number;
  /** Single click: open in the preview tab. */
  onOpenFile: (path: string) => void;
  /** Double click: open in a tab that stays. */
  onPinFile: (path: string) => void;
  /** Recently opened folders, most recent first. */
  recents: string[];
  /** Opens `path`, or asks for a folder without one. */
  onOpenFolder: (path?: string) => void;
  onNewWindow: () => void;
  onRefresh: () => void;
  onCreate: (parent: string, name: string, kind: "file" | "folder") => Promise<void>;
  onRename: (path: string, newName: string, isDir: boolean) => Promise<void>;
  onTrash: (path: string) => void;
  onReveal: (path: string) => void;
  /** Shows the search panel instead of the file tree. */
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  onOpenMatch: (path: string, line: number) => void;
  /** The web version shows the source control button anyway (to say it needs the desktop app), when it's turned on. */
  gitOffered?: boolean;
  /** Shows the source control panel instead of the file tree; only offered in a git repository. */
  gitOpen: boolean;
  onGitOpenChange: (open: boolean) => void;
  /** Null outside a git repository. */
  gitPanel: ReactNode | null;
  /** How many files have changed, shown on the panel's button. */
  gitChanges: number;
  /** The git letter of each changed file in the folder (M, A, D, U, !), by path. */
  gitBadges: Map<string, string>;
}

function filterTree(nodes: FileNode[], query: string): FileNode[] {
  const q = query.toLowerCase();
  const out: FileNode[] = [];
  for (const node of nodes) {
    if (node.isDir) {
      const children = filterTree(node.children ?? [], query);
      if (children.length) out.push({ ...node, children });
    } else if (node.name.toLowerCase().includes(q)) {
      out.push(node);
    }
  }
  return out;
}

function firstFile(nodes: FileNode[]): FileNode | undefined {
  for (const node of nodes) {
    if (!node.isDir) return node;
    const found = firstFile(node.children ?? []);
    if (found) return found;
  }
}

export default function Sidebar(props: SidebarProps) {
  const { root, tree, activePath, width, onOpenFile, onOpenFolder, onRefresh } = props;
  const [query, setQuery] = useState("");
  const [expandedByRoot, setExpandedByRoot] = useStoredState<Record<string, string[]>>("mido.expanded", {});
  const [pending, setPending] = useState<Pending | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const expanded = useMemo(() => new Set(expandedByRoot[root] ?? []), [expandedByRoot, root]);
  const setExpanded = (update: (s: Set<string>) => void) =>
    setExpandedByRoot((prev) => {
      const next = new Set(prev[root] ?? []);
      update(next);
      return { ...prev, [root]: [...next] };
    });

  const toggle = (path: string) =>
    setExpanded((s) => (s.has(path) ? s.delete(path) : s.add(path)));

  // Reveal the active file by expanding its ancestors.
  useEffect(() => {
    if (!activePath || !isInside(root, activePath)) return;
    const ancestors: string[] = [];
    for (let dir = dirname(activePath); dir.length > root.length; dir = dirname(dir)) ancestors.push(dir);
    if (ancestors.some((a) => !expanded.has(a))) setExpanded((s) => ancestors.forEach((a) => s.add(a)));
  }, [activePath, root]);

  useEffect(() => {
    const focus = () => {
      filterRef.current?.focus();
      filterRef.current?.select();
    };
    window.addEventListener("mido:focus-filter", focus);
    return () => window.removeEventListener("mido:focus-filter", focus);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const visible = useMemo(() => (query ? filterTree(tree, query) : tree), [tree, query]);

  const startCreate = (kind: "new-file" | "new-folder", parent: string) => {
    if (requireDesktop(kind === "new-file" ? "Creating files" : "Creating folders")) return;
    if (parent !== root) setExpanded((s) => s.add(parent));
    setQuery("");
    setPending({ kind, parent });
  };

  const commitPending = async (value: string) => {
    const current = pending;
    setPending(null);
    const name = value.trim();
    if (!current || !name) return;
    if (current.kind === "rename") {
      if (name !== basename(current.path)) await props.onRename(current.path, name, current.isDir);
    } else {
      await props.onCreate(current.parent, name, current.kind === "new-file" ? "file" : "folder");
    }
  };

  const openMenu = (e: MouseEvent, node: FileNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, node });
  };

  const onFilterKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setQuery("");
      e.currentTarget.blur();
    } else if (e.key === "Enter") {
      const file = firstFile(visible);
      if (file) onOpenFile(file.path);
    }
  };

  const renderPendingNew = (parent: string, depth: number) =>
    pending && pending.kind !== "rename" && pending.parent === parent ? (
      <InlineInput
        depth={depth}
        isDir={pending.kind === "new-folder"}
        initial=""
        placeholder={pending.kind === "new-folder" ? "Folder name" : "File name.md"}
        onCommit={commitPending}
        onCancel={() => setPending(null)}
      />
    ) : null;

  const renderNodes = (nodes: FileNode[], depth: number) =>
    nodes.map((node) => {
      const isRenaming = pending?.kind === "rename" && pending.path === node.path;
      if (node.isDir) {
        const open = query !== "" || expanded.has(node.path);
        return (
          <div key={node.path} role="group">
            {isRenaming ? (
              <InlineInput
                depth={depth}
                isDir
                initial={node.name}
                onCommit={commitPending}
                onCancel={() => setPending(null)}
              />
            ) : (
              <button
                className="tree-row dir"
                style={{ paddingLeft: 10 + depth * 14 }}
                onClick={() => toggle(node.path)}
                onContextMenu={(e) => openMenu(e, node)}
                title={node.path}
              >
                <ChevronRight size={13} className={`chevron ${open ? "open" : ""}`} />
                {open ? <FolderOpen size={15} className="icon" /> : <Folder size={15} className="icon" />}
                <span className="name">{node.name}</span>
              </button>
            )}
            {open && (
              <div className="tree-children">
                {renderPendingNew(node.path, depth + 1)}
                {renderNodes(node.children ?? [], depth + 1)}
              </div>
            )}
          </div>
        );
      }
      if (isRenaming) {
        return (
          <InlineInput
            key={node.path}
            depth={depth}
            isDir={false}
            initial={node.name}
            onCommit={commitPending}
            onCancel={() => setPending(null)}
          />
        );
      }
      return (
        <button
          key={node.path}
          className={`tree-row file ${node.path === activePath ? "active" : ""}`}
          style={{ paddingLeft: 10 + depth * 14 + 17 }}
          onClick={() => onOpenFile(node.path)}
          onDoubleClick={() => props.onPinFile(node.path)}
          onContextMenu={(e) => openMenu(e, node)}
          title={node.path}
        >
          <FileText size={15} className="icon" />
          <span className="name">{highlightMatch(node.name, query)}</span>
          {props.gitBadges.has(node.path) && <GitBadge letter={props.gitBadges.get(node.path)!} />}
        </button>
      );
    });

  const menuTarget = menu?.node;
  const menuParent = menuTarget ? (menuTarget.isDir ? menuTarget.path : dirname(menuTarget.path)) : root;

  return (
    <aside className="sidebar" style={{ width }}>
      <div className={`sidebar-header ${macWindowInset ? "mac" : ""}`} data-tauri-drag-region>
        {isWeb && <WebBrand />}
        <div className="sidebar-actions">
          <IconButton title="New file" onClick={() => startCreate("new-file", root)}>
            <FilePlus size={15} />
          </IconButton>
          <IconButton title="New folder" onClick={() => startCreate("new-folder", root)}>
            <FolderPlus size={15} />
          </IconButton>
          <IconButton title="Refresh" onClick={onRefresh}>
            <RefreshCw size={14} />
          </IconButton>
          <IconButton
            title={`Search in files (${isMac ? "⌘⇧F" : "Ctrl+Shift+F"})`}
            active={props.searchOpen}
            onClick={() => props.onSearchOpenChange(!props.searchOpen)}
          >
            <Search size={14} />
          </IconButton>
          {(props.gitPanel !== null || (isWeb && props.gitOffered)) && (
            <IconButton
              title={`Source control (${isMac ? "⌃⇧G" : "Ctrl+Shift+G"})`}
              active={props.gitOpen}
              onClick={() => !requireDesktop("Source control") && props.onGitOpenChange(!props.gitOpen)}
            >
              <GitBranch size={14} />
              {props.gitChanges > 0 && <span className="icon-badge">{props.gitChanges > 99 ? "99+" : props.gitChanges}</span>}
            </IconButton>
          )}
        </div>
      </div>

      <WorkspaceSwitcher
        root={root}
        recents={props.recents}
        onOpenFolder={onOpenFolder}
        onNewWindow={props.onNewWindow}
      />

      {props.gitOpen && props.gitPanel}

      <SearchPanel
        visible={props.searchOpen && !props.gitOpen}
        root={root}
        tree={tree}
        activePath={activePath}
        onOpenMatch={props.onOpenMatch}
        onClose={() => props.onSearchOpenChange(false)}
      />

      <div className="filter" hidden={props.searchOpen || props.gitOpen}>
        <Search size={13} className="filter-icon" />
        <input
          ref={filterRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onFilterKey}
          placeholder="Filter files"
          spellCheck={false}
        />
        {query && (
          <button className="filter-clear" onClick={() => setQuery("")} title="Clear">
            <X size={12} />
          </button>
        )}
      </div>

      <nav className="tree" hidden={props.searchOpen || props.gitOpen} onContextMenu={(e) => openMenu(e, null)}>
        {renderPendingNew(root, 0)}
        {renderNodes(visible, 0)}
        {visible.length === 0 && !pending && (
          <div className="tree-empty">{query ? "No matching files" : "No Markdown files here yet"}</div>
        )}
      </nav>

      {menu && (
        <div
          className="context-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 200) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <MenuItem icon={<FilePlus size={14} />} label="New File" onClick={() => { setMenu(null); startCreate("new-file", menuParent); }} />
          <MenuItem icon={<FolderPlus size={14} />} label="New Folder" onClick={() => { setMenu(null); startCreate("new-folder", menuParent); }} />
          {menuTarget && (
            <>
              <div className="menu-sep" />
              <MenuItem
                icon={<Pencil size={14} />}
                label="Rename"
                onClick={() => {
                  setMenu(null);
                  if (requireDesktop("Renaming")) return;
                  setPending({ kind: "rename", path: menuTarget.path, isDir: menuTarget.isDir });
                }}
              />
              <MenuItem
                icon={<FolderOpen size={14} />}
                label={isMac ? "Reveal in Finder" : "Show in Folder"}
                onClick={() => { setMenu(null); props.onReveal(menuTarget.path); }}
              />
              <div className="menu-sep" />
              <MenuItem
                icon={<Trash size={14} />}
                label="Move to Trash"
                danger
                onClick={() => { setMenu(null); props.onTrash(menuTarget.path); }}
              />
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

function InlineInput(props: {
  depth: number;
  isDir: boolean;
  initial: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    // Select the name without its extension, like Finder does.
    const dot = props.isDir ? -1 : props.initial.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : props.initial.length);
  }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const value = ref.current?.value ?? "";
    if (commit && value.trim()) props.onCommit(value);
    else props.onCancel();
  };

  return (
    <div className="tree-row editing" style={{ paddingLeft: 10 + props.depth * 14 + (props.isDir ? 0 : 17) }}>
      {props.isDir ? <Folder size={15} className="icon" /> : <FileText size={15} className="icon" />}
      <input
        ref={ref}
        defaultValue={props.initial}
        placeholder={props.placeholder}
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          else if (e.key === "Escape") finish(false);
        }}
        onBlur={() => finish(true)}
      />
    </div>
  );
}

function GitBadge({ letter }: { letter: string }) {
  const meaning: Record<string, string> = {
    M: "Modified",
    A: "Added",
    D: "Deleted",
    R: "Renamed",
    U: "Untracked",
    "!": "Conflict",
  };
  return (
    <span className={`git-letter git-letter-${letter === "!" ? "conflict" : letter}`} title={meaning[letter] ?? "Changed"}>
      {letter}
    </span>
  );
}

function MenuItem(props: { icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button className={`menu-item ${props.danger ? "danger" : ""}`} onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

export function IconButton(props: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`icon-button ${props.active ? "active" : ""}`}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
