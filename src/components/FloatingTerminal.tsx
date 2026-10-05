import { useCallback, useEffect, useRef, useState } from "react";
import { PanelBottom } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TerminalView, type TerminalViewHandle } from "./TerminalPanel";
import { dockTerminal, takeFloatingTerminal, type Handoff } from "../lib/terminal";
import { useAppearance } from "../lib/useAppearance";
import { isMac, macWindowInset } from "../lib/platform";

// Asked once, outside React: the backend gives the terminal to the first ask only.
const taken = takeFloatingTerminal().catch(() => null);

const closeWindow = () => void getCurrentWindow().destroy();

/**
 * A terminal in a window of its own (src-tauri/src/floating.rs), to place
 * anywhere on the desktop. Closing it puts the terminal back in the panel it
 * came from.
 */
export default function FloatingTerminal() {
  useAppearance();

  const [handoff, setHandoff] = useState<Handoff | null>(null);
  useEffect(() => {
    void taken.then((h) => (h ? setHandoff(h) : closeWindow()));
  }, []);

  const view = useRef<TerminalViewHandle | null>(null);
  const register = useCallback((_key: number, v: TerminalViewHandle | null) => {
    view.current = v;
    v?.term.focus();
  }, []);

  /** Puts the terminal back in its panel, and closes. */
  const docking = useRef(false);
  const dock = useCallback(async () => {
    if (docking.current) return;
    docking.current = true;
    const released = await view.current?.release();
    if (!released || !handoff) return closeWindow();
    // Should it fail, the window closes anyway, rather than stay open for good.
    await dockTerminal({ ...released, title: handoff.title }).catch(closeWindow);
  }, [handoff]);

  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested((e) => {
      e.preventDefault();
      void dock();
    });
    return () => void unlisten.then((f) => f());
  }, [dock]);

  // A shell that exits normally closes its window, as it would close its tab.
  const onExit = useCallback((_key: number, code: number | null) => {
    if (code === 0 || code === null) return closeWindow();
    view.current?.term.write(`\r\n\x1b[2m[The shell exited with code ${code}. Close the window.]\x1b[0m\r\n`);
  }, []);

  // The Terminal menu's items for this terminal.
  useEffect(() => {
    const unlisteners = [
      getCurrentWindow().listen("menu-clear-terminal", () => view.current?.term.clear()),
      getCurrentWindow().listen("menu-kill-terminal", () => {
        view.current?.kill();
        closeWindow();
      }),
    ];
    return () => {
      for (const u of unlisteners) void u.then((f) => f());
    };
  }, []);

  // ⌘+ / ⌘− / ⌘0: this terminal's text size, shown for a moment. ⌘W: back to the panel.
  const [zoomed, setZoomed] = useState<number | null>(null);
  useEffect(() => {
    if (zoomed === null) return;
    const t = setTimeout(() => setZoomed(null), 1500);
    return () => clearTimeout(t);
  }, [zoomed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(isMac ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return;
      const zoom = ["+", "="].includes(e.key) ? 1 : e.key === "-" ? -1 : e.key === "0" ? 0 : null;
      if (zoom !== null) {
        e.preventDefault();
        void view.current?.zoom(zoom).then(setZoomed);
      } else if (e.code === "KeyW") {
        e.preventDefault();
        void dock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dock]);

  return (
    <div className="floating-terminal">
      <header className={`floating-terminal-header ${macWindowInset ? "mac-inset" : ""}`} data-tauri-drag-region>
        <span className="floating-terminal-title" data-tauri-drag-region>
          {handoff?.title}
          {zoomed !== null && <span className="floating-terminal-zoom"> · {zoomed}px</span>}
        </span>
        <button
          className="icon-button"
          title="Move Terminal Back to Panel (⌘W)"
          aria-label="Move Terminal Back to Panel"
          onClick={() => void dock()}
        >
          <PanelBottom size={14} />
        </button>
      </header>
      <div className="terminal-body">
        {handoff && (
          <TerminalView active visible sessionKey={0} register={register} onExit={onExit} handoff={handoff} />
        )}
      </div>
    </div>
  );
}
