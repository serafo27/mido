import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { PictureInPicture2, Plus, SquareTerminal, Trash2, X } from "lucide-react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  attachTerminal,
  detachTerminal,
  killTerminal,
  openTerminalWindow,
  resizeTerminal,
  spawnTerminal,
  writeTerminal,
  type Handoff,
  type TerminalHandlers,
} from "../lib/terminal";
import { isMac } from "../lib/platform";
import { ANSI_KEYS, ansiVariable } from "../lib/themes";
import { terminalFontSize, zoomTerminal } from "../lib/settings";

/** What the app asks of the panel: from the Terminal menu and its shortcuts. */
export interface TerminalPanelHandle {
  newTerminal: () => void;
  /** Whether there's a terminal to show. */
  hasTerminals: () => boolean;
  clear: () => void;
  kill: () => void;
  focus: () => void;
  /** ⌘+ / ⌘− / ⌘0 on the selected terminal only; resolves to its new text size. */
  zoom: (steps: number) => Promise<number | null>;
  /** A floating terminal came back. */
  adopt: (handoff: Handoff) => void;
}

/** What's kept of each terminal's view. */
export interface TerminalViewHandle {
  term: XTerm;
  fit: () => void;
  kill: () => void;
  zoom: (steps: number) => Promise<number>;
  /**
   * Lets go of the shell, to move it to another window: its output is held
   * back from now on, and its screen is saved. Null when it has no shell left.
   */
  release: () => Promise<Omit<Handoff, "title"> | null>;
  /** Takes the shell back after a move that failed. */
  resume: (pty: number) => Promise<void>;
}

interface Session {
  key: number;
  title: string;
  /** Came from another window: its shell is already running. */
  handoff?: Handoff;
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
    // The system's monospaced font by default, as in Terminal; Settings can name another.
    fontFamily: v("--terminal-font") || "ui-monospace, Menlo, monospace",
    fontSize: parseFloat(v("--editor-font-size")) || 14,
  };
}

/**
 * Waits for a font to be ready. xterm.js measures its character cell once, when the
 * font is set: measured on a stand-in font, every glyph would sit off the grid.
 */
const fontReady = (family: string, size: number) =>
  document.fonts.load(`${size}px ${family}`).then(
    () => undefined,
    () => undefined,
  );

/** The app's shortcuts that a terminal should leave to the app. */
export function isAppShortcut(e: KeyboardEvent): boolean {
  if (isMac && e.metaKey) return true;
  return e.ctrlKey && (e.code === "Backquote" || e.code === "IntlBackslash");
}

interface ViewProps {
  active: boolean;
  visible: boolean;
  register: (key: number, view: TerminalViewHandle | null) => void;
  sessionKey: number;
  onExit: (key: number, code: number | null) => void;
  /** The shell to show, when it comes from another window; otherwise a new one starts. */
  handoff?: Handoff;
}

/** One terminal: an xterm.js view of a shell in the backend. It stays mounted while hidden, so the shell keeps going. */
export function TerminalView({ active, visible, register, sessionKey, onExit, handoff }: ViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let term: XTerm | null = null;
    let fitAddon: FitAddon | null = null;
    let pty: number | null = null;
    let observer: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    // This terminal's own text size, as pixels away from the editor's.
    let fontOffset = handoff?.fontOffset ?? 0;
    // Bytes received since the shell was attached, to know when all it sent has come.
    let received = 0;

    (async () => {
      // xterm.js is only loaded once a terminal is opened.
      const look = appearance();
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }, { WebglAddon }, { Unicode11Addon }, { SerializeAddon }] =
        await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
          import("@xterm/addon-web-links"),
          import("@xterm/addon-webgl"),
          import("@xterm/addon-unicode11"),
          import("@xterm/addon-serialize"),
          fontReady(look.fontFamily, terminalFontSize(look.fontSize, fontOffset)),
        ]);
      if (disposed || !hostRef.current) return;
      term = new Terminal({
        ...look,
        fontSize: terminalFontSize(look.fontSize, fontOffset),
        // A screen from another window is restored at the size it was saved at, then fitted.
        ...(handoff && { cols: handoff.cols, rows: handoff.rows }),
        cursorBlink: true,
        // The Unicode 11 widths below are a "proposed" xterm.js API.
        allowProposedApi: true,
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
      // Emoji and East Asian characters take two cells, as the shell expects: without it the cursor drifts after them.
      term.loadAddon(new Unicode11Addon());
      term.unicode.activeVersion = "11";
      const serializer = new SerializeAddon();
      term.loadAddon(serializer);
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
      if (handoff) {
        await new Promise<void>((done) => term!.write(handoff.screen, done));
        if (disposed) return;
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
      /** Sets the font, once it's ready, and fits the new character cells to the space. */
      const setFont = async (fontFamily: string, fontSize: number) => {
        if (!term) return;
        if (fontFamily !== term.options.fontFamily || fontSize !== term.options.fontSize) {
          await fontReady(fontFamily, fontSize);
          if (disposed || !term) return;
          term.options.fontFamily = fontFamily;
          term.options.fontSize = fontSize;
        }
        fit();
      };
      // Follows the app's theme and fonts.
      themeObserver = new MutationObserver(async () => {
        if (!term) return;
        const next = appearance();
        term.options.theme = next.theme;
        await setFont(next.fontFamily, terminalFontSize(next.fontSize, fontOffset));
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] });

      const handlers: TerminalHandlers = {
        onData: (data) => {
          received += data.length;
          term?.write(data);
        },
        onExit: (code) => {
          pty = null;
          if (!disposed) onExit(sessionKey, code);
        },
      };
      const attach = async (id: number) => {
        received = 0;
        await attachTerminal(id, handlers);
        pty = id;
        if (term) void resizeTerminal(id, term.cols, term.rows).catch(() => {});
      };

      register(sessionKey, {
        term,
        fit,
        // Killed once: closing the view afterwards finds no shell left to kill.
        kill: () => {
          if (pty === null) return;
          void killTerminal(pty).catch(() => {});
          pty = null;
        },
        zoom: async (steps) => {
          const { fontFamily, fontSize } = appearance();
          fontOffset = zoomTerminal(fontSize, fontOffset, steps);
          const size = terminalFontSize(fontSize, fontOffset);
          await setFont(fontFamily, size);
          return size;
        },
        release: async () => {
          if (pty === null || !term) return null;
          const id = pty;
          let sent: number;
          try {
            sent = await detachTerminal(id);
          } catch {
            return null;
          }
          // Not ours any more: typing stops, and closing the view leaves the shell running.
          pty = null;
          // What the shell sent before may still be on its way, then xterm.js may still be drawing it.
          const deadline = performance.now() + 1000;
          while (received < sent && performance.now() < deadline) await new Promise((r) => setTimeout(r, 10));
          await new Promise<void>((done) => term!.write("", done));
          return { pty: id, screen: serializer.serialize(), cols: term.cols, rows: term.rows, fontOffset };
        },
        resume: attach,
      });

      if (handoff) {
        try {
          await attach(handoff.pty);
          if (disposed) void killTerminal(handoff.pty).catch(() => {});
        } catch {
          // Its shell ended on the way.
          if (!disposed) onExit(sessionKey, null);
        }
        return;
      }
      try {
        pty = await spawnTerminal(term.cols, term.rows, handlers);
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
  onError: (e: unknown) => void;
}

/** Terminals under the document, as in VS Code: tabs, and the shell of the selected one. */
const TerminalPanel = forwardRef<TerminalPanelHandle, PanelProps>(function TerminalPanel(props, ref) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeKey, setActiveKey] = useState<number | null>(null);
  const views = useRef(new Map<number, TerminalViewHandle>());
  const nextKey = useRef(1);
  const live = useRef({ sessions, activeKey });
  live.current = { sessions, activeKey };

  const register = useCallback((key: number, view: TerminalViewHandle | null) => {
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
      if (rest.length === 0) {
        // With no terminal left, the next one is Terminal 1 again.
        nextKey.current = 1;
        props.onEmpty();
      }
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

  /** Ends a terminal's shell and closes it: the one given, or the selected one. */
  const kill = useCallback(
    (key = live.current.activeKey) => {
      if (key === null) return;
      views.current.get(key)?.kill();
      remove(key);
    },
    [remove],
  );

  /** Moves a terminal into a window of its own; it comes back when that window closes. */
  const moving = useRef(false);
  const float = useCallback(
    async (key = live.current.activeKey) => {
      const view = key === null ? undefined : views.current.get(key);
      const session = live.current.sessions.find((s) => s.key === key);
      if (!view || !session || moving.current) return;
      moving.current = true;
      try {
        const handoff = await view.release();
        if (!handoff) return;
        try {
          await openTerminalWindow({ ...handoff, title: session.title });
          remove(session.key);
        } catch (e) {
          await view.resume(handoff.pty).catch(() => {});
          props.onError(e);
        }
      } finally {
        moving.current = false;
      }
    },
    [remove, props.onError],
  );

  const adopt = useCallback((handoff: Handoff) => {
    const key = nextKey.current++;
    setSessions((s) => [...s, { key, title: handoff.title, handoff }]);
    setActiveKey(key);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      newTerminal,
      adopt,
      kill: () => kill(),
      hasTerminals: () => live.current.sessions.length > 0,
      clear: () => {
        const { activeKey } = live.current;
        if (activeKey !== null) views.current.get(activeKey)?.term.clear();
      },
      focus: () => {
        const { activeKey } = live.current;
        if (activeKey !== null) requestAnimationFrame(() => views.current.get(activeKey)?.term.focus());
      },
      zoom: async (steps) => {
        const { activeKey } = live.current;
        const view = activeKey === null ? undefined : views.current.get(activeKey);
        return view ? view.zoom(steps) : null;
      },
    }),
    [newTerminal, kill, adopt],
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
            <div
              key={s.key}
              role="tab"
              tabIndex={0}
              aria-selected={s.key === activeKey}
              className={`terminal-tab ${s.key === activeKey ? "selected" : ""}`}
              onClick={() => select(s.key)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && select(s.key)}
              onAuxClick={(e) => e.button === 1 && kill(s.key)}
            >
              <SquareTerminal size={13} />
              <span>{s.title}</span>
              <button
                className="terminal-tab-close"
                title="Kill Terminal"
                aria-label={`Kill ${s.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  kill(s.key);
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="terminal-actions">
          <button className="icon-button" title="New Terminal (⌃⇧`)" aria-label="New Terminal" onClick={newTerminal}>
            <Plus size={15} />
          </button>
          <button
            className="icon-button"
            title="Move Terminal to New Window"
            aria-label="Move Terminal to New Window"
            onClick={() => void float()}
          >
            <PictureInPicture2 size={14} />
          </button>
          <button className="icon-button" title="Kill Terminal" aria-label="Kill Terminal" onClick={() => kill()}>
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
            handoff={s.handoff}
          />
        ))}
      </div>
    </section>
  );
});

export default TerminalPanel;
