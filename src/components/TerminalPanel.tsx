import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Plus, SquareTerminal, Trash2, X } from "lucide-react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { killTerminal, resizeTerminal, spawnTerminal, writeTerminal } from "../lib/terminal";
import { isMac } from "../lib/platform";
import { ANSI_KEYS, ansiVariable } from "../lib/themes";

/** What the app asks of the panel: from the Terminal menu and its shortcuts. */
export interface TerminalPanelHandle {
  newTerminal: () => void;
  /** Whether there's a terminal to show. */
  hasTerminals: () => boolean;
  clear: () => void;
  kill: () => void;
  focus: () => void;
}

interface Session {
  key: number;
  title: string;
}

/**
 * A theme colour as xterm.js can read it. Theme variables may be any CSS colour,
 * including color-mix(), which xterm.js doesn't parse: painting it on a pixel
 * gives the plain colour back, as #rrggbb (or #rrggbbaa when see-through).
 */
let probe: CanvasRenderingContext2D | null | undefined;
function plainColor(css: string): string | undefined {
  if (!css) return undefined;
  probe ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", {
    willReadFrequently: true,
  });
  if (!probe) return css;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}${a === 255 ? "" : hex(a)}`;
}

/** The terminal's colours and font, from the app theme (its --ansi-* colours come from lib/themes). */
function appearance() {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  const color = (name: string) => plainColor(v(name));
  const ansi = Object.fromEntries(ANSI_KEYS.map((key) => [key, color(ansiVariable(key))]));
  return {
    theme: {
      ...ansi,
      background: color("--bg"),
      foreground: color("--text"),
      cursor: color("--accent"),
      cursorAccent: color("--bg"),
      selectionBackground: color("--selection"),
      scrollbarSliderBackground: color("--bg-hover"),
    },
    fontFamily: v("--md-font-code") || v("--font-mono") || "Menlo, monospace",
    fontSize: Math.max(10, Math.round((parseFloat(v("--editor-font-size")) || 14) - 1)),
  };
}

/** The app's shortcuts that a terminal should leave to the app. */
export function isAppShortcut(e: KeyboardEvent): boolean {
  if (isMac && e.metaKey) return true;
  return e.ctrlKey && (e.code === "Backquote" || e.code === "IntlBackslash");
}

interface ViewProps {
  active: boolean;
  visible: boolean;
  register: (key: number, view: { term: XTerm; fit: () => void; kill: () => void } | null) => void;
  sessionKey: number;
  onExit: (key: number, code: number | null) => void;
}

/** One terminal: an xterm.js view of a shell in the backend. It stays mounted while hidden, so the shell keeps going. */
function TerminalView({ active, visible, register, sessionKey, onExit }: ViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let term: XTerm | null = null;
    let fitAddon: FitAddon | null = null;
    let pty: number | null = null;
    let observer: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;

    (async () => {
      // xterm.js is only loaded once a terminal is opened.
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }, { WebglAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
        import("@xterm/addon-webgl"),
      ]);
      if (disposed || !hostRef.current) return;
      term = new Terminal({
        ...appearance(),
        cursorBlink: true,
        allowProposedApi: false,
        scrollback: 5000,
        macOptionClickForcesSelection: true,
        // As VS Code: colours a program picks that would be hard to read on this background are adjusted.
        minimumContrastRatio: 4.5,
        // Box drawing, block and Powerline characters are drawn to fill their cell, so prompts join up.
        customGlyphs: true,
      });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon((_event, uri) => void openUrl(uri)));
      term.attachCustomKeyEventHandler((e) => !isAppShortcut(e));
      term.open(hostRef.current);
      // Drawn on the GPU, as in VS Code: crisp, evenly spaced text. When WebGL isn't
      // available, or the GPU drops its context, the terminal falls back to the DOM renderer.
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // No WebGL here: the DOM renderer stays.
      }

      const fit = () => {
        const host = hostRef.current;
        if (!term || !fitAddon || !host || host.offsetWidth === 0 || host.offsetHeight === 0) return;
        fitAddon.fit();
      };
      fitRef.current = fit;
      fit();

      term.onData((data) => pty !== null && void writeTerminal(pty, data).catch(() => {}));
      term.onResize(({ cols, rows }) => pty !== null && void resizeTerminal(pty, cols, rows).catch(() => {}));
      observer = new ResizeObserver(() => requestAnimationFrame(fit));
      observer.observe(hostRef.current);
      // Follows the app's theme and fonts.
      themeObserver = new MutationObserver(() => {
        if (!term) return;
        const next = appearance();
        term.options.theme = next.theme;
        term.options.fontFamily = next.fontFamily;
        term.options.fontSize = next.fontSize;
        fit();
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] });

      register(sessionKey, {
        term,
        fit,
        kill: () => pty !== null && void killTerminal(pty).catch(() => {}),
      });

      try {
        pty = await spawnTerminal(term.cols, term.rows, {
          onData: (data) => term?.write(data),
          onExit: (code) => {
            pty = null;
            if (!disposed) onExit(sessionKey, code);
          },
        });
        if (disposed) void killTerminal(pty).catch(() => {});
      } catch (e) {
        term.write(`\x1b[31m${e instanceof Error ? e.message : String(e)}\x1b[0m\r\n`);
      }
    })();

    return () => {
      disposed = true;
      register(sessionKey, null);
      observer?.disconnect();
      themeObserver?.disconnect();
      if (pty !== null) void killTerminal(pty).catch(() => {});
      term?.dispose();
    };
  }, []);

  // Showing a terminal again: it fits its space and takes the keyboard.
  useEffect(() => {
    if (!active || !visible) return;
    requestAnimationFrame(() => fitRef.current());
  }, [active, visible]);

  return <div className="terminal-view" ref={hostRef} hidden={!active} />;
}

interface PanelProps {
  visible: boolean;
  height: number;
  onResize: (height: number) => void;
  onHide: () => void;
  /** No terminals are left. */
  onEmpty: () => void;
}

/** Terminals under the document, as in VS Code: tabs, and the shell of the selected one. */
const TerminalPanel = forwardRef<TerminalPanelHandle, PanelProps>(function TerminalPanel(props, ref) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeKey, setActiveKey] = useState<number | null>(null);
  const views = useRef(new Map<number, { term: XTerm; fit: () => void; kill: () => void }>());
  const nextKey = useRef(1);
  const live = useRef({ sessions, activeKey });
  live.current = { sessions, activeKey };

  const register = useCallback((key: number, view: { term: XTerm; fit: () => void; kill: () => void } | null) => {
    if (view) {
      views.current.set(key, view);
      if (live.current.activeKey === key) view.term.focus();
    } else views.current.delete(key);
  }, []);

  const remove = useCallback(
    (key: number) => {
      const { sessions } = live.current;
      const index = sessions.findIndex((s) => s.key === key);
      if (index < 0) return;
      const rest = sessions.filter((s) => s.key !== key);
      setSessions(rest);
      if (live.current.activeKey === key) {
        const next = rest[Math.min(index, rest.length - 1)];
        setActiveKey(next?.key ?? null);
        if (next) requestAnimationFrame(() => views.current.get(next.key)?.term.focus());
      }
      if (rest.length === 0) props.onEmpty();
    },
    [props.onEmpty],
  );

  const onExit = useCallback(
    (key: number, code: number | null) => {
      // A shell that exits normally (`exit`, ⌃D) closes its terminal, as in VS Code; a failure stays readable.
      if (code === 0 || code === null) return remove(key);
      views.current
        .get(key)
        ?.term.write(`\r\n\x1b[2m[The shell exited with code ${code}. Close the terminal with the bin.]\x1b[0m\r\n`);
    },
    [remove],
  );

  const newTerminal = useCallback(() => {
    const key = nextKey.current++;
    setSessions((s) => [...s, { key, title: `Terminal ${key}` }]);
    setActiveKey(key);
  }, []);

  const kill = useCallback(() => {
    const { activeKey } = live.current;
    if (activeKey === null) return;
    views.current.get(activeKey)?.kill();
    remove(activeKey);
  }, [remove]);

  useImperativeHandle(
    ref,
    () => ({
      newTerminal,
      kill,
      hasTerminals: () => live.current.sessions.length > 0,
      clear: () => {
        const { activeKey } = live.current;
        if (activeKey !== null) views.current.get(activeKey)?.term.clear();
      },
      focus: () => {
        const { activeKey } = live.current;
        if (activeKey !== null) requestAnimationFrame(() => views.current.get(activeKey)?.term.focus());
      },
    }),
    [newTerminal, kill],
  );

  const select = (key: number) => {
    setActiveKey(key);
    requestAnimationFrame(() => views.current.get(key)?.term.focus());
  };

  const dragResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = props.height;
    const max = Math.max(160, window.innerHeight * 0.75);
    const onMove = (ev: PointerEvent) => props.onResize(Math.min(max, Math.max(110, startHeight + startY - ev.clientY)));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("resizing-row");
    };
    document.body.classList.add("resizing-row");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (sessions.length === 0) return null;
  return (
    <section className="terminal-panel" hidden={!props.visible} style={{ height: props.height }} aria-label="Terminal">
      <div className="resizer terminal-resizer" onPointerDown={dragResize} />
      <header className="terminal-header">
        <div className="terminal-tabs" role="tablist">
          {sessions.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={s.key === activeKey}
              className={`terminal-tab ${s.key === activeKey ? "selected" : ""}`}
              onClick={() => select(s.key)}
            >
              <SquareTerminal size={13} />
              <span>{s.title}</span>
            </button>
          ))}
        </div>
        <div className="terminal-actions">
          <button className="icon-button" title="New Terminal (⌃⇧`)" aria-label="New Terminal" onClick={newTerminal}>
            <Plus size={15} />
          </button>
          <button className="icon-button" title="Kill Terminal" aria-label="Kill Terminal" onClick={kill}>
            <Trash2 size={14} />
          </button>
          <button className="icon-button" title="Hide Terminal (⌃`)" aria-label="Hide Terminal" onClick={props.onHide}>
            <X size={15} />
          </button>
        </div>
      </header>
      <div className="terminal-body">
        {sessions.map((s) => (
          <TerminalView
            key={s.key}
            sessionKey={s.key}
            active={s.key === activeKey}
            visible={props.visible}
            register={register}
            onExit={onExit}
          />
        ))}
      </div>
    </section>
  );
});

export default TerminalPanel;
