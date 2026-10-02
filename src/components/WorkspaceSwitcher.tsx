import { useEffect, useRef, useState } from "react";
import { AppWindow, Check, ChevronsUpDown, Folder, FolderOpen } from "lucide-react";
import { basename, dirname, tildify } from "../lib/paths";
import { isMac, isWeb, modKey } from "../lib/platform";
import { canReadFolders } from "./Welcome";

/**
 * The open folder, at the top of the sidebar. Clicking it switches to another
 * one: a recent folder, one picked in the dialog, or a new window.
 */
export default function WorkspaceSwitcher(props: {
  root: string;
  recents: string[];
  onOpenFolder: (path?: string) => void;
  onNewWindow: () => void;
}) {
  const { root } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = basename(root) || root;
  // The web version's folders have no real location to show.
  const location = isWeb ? null : tildify(dirname(root));
  // In the web version only Chromium can reopen a folder without picking it again.
  const others = isWeb && !canReadFolders ? [] : props.recents.filter((path) => path !== root);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="folder-switcher" ref={ref}>
      <button
        className={`folder-button ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={`${root}\nClick to switch folder`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="folder-icon">
          <Folder size={14} />
        </span>
        <span className="folder-text">
          <span className="folder-label">Folder</span>
          <span className="folder-title">{name}</span>
        </span>
        <ChevronsUpDown size={14} className="folder-chevron" />
      </button>

      {open && (
        <div className="context-menu folder-menu" role="menu">
          <div className="menu-heading">Open folder</div>
          <div className="folder-current" title={root}>
            <Check size={14} />
            <span className="folder-option-name">{name}</span>
            {location && <span className="folder-option-path">{location}</span>}
          </div>
          {others.length > 0 && (
            <>
              <div className="menu-sep" />
              <div className="menu-heading">Recent</div>
              {others.map((path) => (
                <button
                  key={path}
                  className="menu-item folder-option"
                  role="menuitem"
                  title={isWeb ? undefined : path}
                  onClick={choose(() => props.onOpenFolder(path))}
                >
                  <Folder size={14} />
                  <span className="folder-option-name">{basename(path) || path}</span>
                  {!isWeb && <span className="folder-option-path">{tildify(dirname(path))}</span>}
                </button>
              ))}
            </>
          )}
          <div className="menu-sep" />
          <button className="menu-item" role="menuitem" onClick={choose(() => props.onOpenFolder())}>
            <FolderOpen size={14} />
            <span>Open Folder…</span>
            <kbd>{modKey}O</kbd>
          </button>
          {!isWeb && (
            <button className="menu-item" role="menuitem" onClick={choose(props.onNewWindow)}>
              <AppWindow size={14} />
              <span>New Window</span>
              <kbd>{isMac ? "⇧⌘N" : "Ctrl+Shift+N"}</kbd>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
