// Embedded with `?view=terminal`: Mido's terminals for a host's terminal panel
// (docs/embed.md). The host opens, selects and closes them; each runs in the
// host's pseudo-terminal, drawn by Mido's TerminalView with Mido's theme.
import { useCallback, useEffect, useRef, useState } from "react";
import { TerminalView, type TerminalViewHandle } from "../components/TerminalPanel";
import type { SpawnOptions } from "../lib/terminal";
import { useAppearance } from "../lib/useAppearance";
import { isMac } from "../lib/platform";
import { notify, on } from "./bridge";
import { hostTerminal } from "./host";

interface Session {
  key: number;
  /** The host's id for it. */
  id: string;
  spawn: SpawnOptions;
}

/** Output is reported at most this often per terminal: enough for a "working" light. */
const OUTPUT_INTERVAL = 1000;

export default function EmbedTerminals() {
  useAppearance();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const views = useRef(new Map<number, TerminalViewHandle>());
  const lastOutput = useRef(new Map<number, number>());
  const nextKey = useRef(1);
  const live = useRef({ sessions, activeId });
  live.current = { sessions, activeId };

  const byId = (id: string) => live.current.sessions.find((s) => s.id === id);
  const idOf = (key: number) => live.current.sessions.find((s) => s.key === key)?.id;
  const focus = (key: number) => requestAnimationFrame(() => views.current.get(key)?.term.focus());

  const register = useCallback((key: number, view: TerminalViewHandle | null) => {
    if (view) {
      views.current.set(key, view);
      if (live.current.sessions.find((s) => s.key === key)?.id === live.current.activeId) view.term.focus();
    } else views.current.delete(key);
  }, []);

  const remove = useCallback((key: number) => {
    setSessions((s) => s.filter((x) => x.key !== key));
    lastOutput.current.delete(key);
  }, []);

  // What the host asks.
  useEffect(() => {
    const offs = [
      on("terminal:new", ({ payload }) => {
        const { id, command, env } = payload as { id: string } & SpawnOptions;
        if (byId(id)) return;
        const key = nextKey.current++;
        setSessions((s) => [...s, { key, id, spawn: { command, env } }]);
        setActiveId(id);
      }),
      on("terminal:select", ({ payload }) => {
        const session = byId(payload as string);
        if (!session) return;
        setActiveId(session.id);
        focus(session.key);
      }),
      on("terminal:kill", ({ payload }) => {
        const session = byId(payload as string);
        if (!session) return;
        views.current.get(session.key)?.kill();
        remove(session.key);
      }),
      on("terminal:clear", ({ payload }) => {
        const session = byId(payload as string);
        if (session) views.current.get(session.key)?.term.clear();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [remove]);

  const onExit = useCallback(
    (key: number, code: number | null) => {
      const id = idOf(key);
      if (id) notify("terminal:exit", { id, code });
      // As in Mido's panel: a normal exit closes the terminal, a failure stays readable.
      if (code === 0 || code === null) return remove(key);
      views.current
        .get(key)
        ?.term.write(`\r\n\x1b[2m[The shell exited with code ${code}. Close the terminal with the bin.]\x1b[0m\r\n`);
    },
    [remove],
  );

  const onOutput = useCallback((key: number) => {
    const now = Date.now();
    if (now - (lastOutput.current.get(key) ?? 0) < OUTPUT_INTERVAL) return;
    lastOutput.current.set(key, now);
    const id = idOf(key);
    if (id) notify("terminal:output", { id });
  }, []);

  const onBell = useCallback((key: number) => {
    const id = idOf(key);
    if (id) notify("terminal:bell", { id });
  }, []);

  // ⌃` and ⌃⇧` are the host's; ⌘+ / ⌘− / ⌘0 zoom the terminal in front, ⌘K clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = live.current.sessions.find((s) => s.id === live.current.activeId);
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.code === "Backquote" || e.code === "IntlBackslash")) {
        e.preventDefault();
        return hostTerminal(e.shiftKey ? "new" : "toggle");
      }
      if (!active || !(isMac ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return;
      const zoom = ["+", "="].includes(e.key) ? 1 : e.key === "-" ? -1 : e.key === "0" ? 0 : null;
      if (zoom !== null) {
        e.preventDefault();
        void views.current.get(active.key)?.zoom(zoom);
      } else if (e.code === "KeyK") {
        e.preventDefault();
        views.current.get(active.key)?.term.clear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="embed-terminals">
      <div className="terminal-body">
        {sessions.map((s) => (
          <TerminalView
            key={s.key}
            sessionKey={s.key}
            active={s.id === activeId}
            visible
            register={register}
            onExit={onExit}
            spawn={s.spawn}
            onOutput={onOutput}
            onBell={onBell}
          />
        ))}
      </div>
    </div>
  );
}
