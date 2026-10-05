import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import CommitDialog from "./CommitDialog";
import PushDialog from "./PushDialog";
import { InOwnWindow } from "./FloatingDialog";
import type { DiffTarget } from "./SourceControl";
import {
  dialogOf,
  GIT_ACTION,
  GIT_RESULT,
  GIT_STATE,
  saveWindowBounds,
  windowParent,
  type GitResult,
  type GitWindowAction,
  type GitWindowMessage,
  type GitWindowState,
} from "../lib/gitWindow";
import { confirmDiscard } from "../lib/useGit";
import { useAppearance } from "../lib/useAppearance";
import { isMac } from "../lib/platform";

// Asked once, outside React.
const me = getCurrentWindow();
const dialog = dialogOf(me.label);
const parentLabel = windowParent().catch(() => null);

/** Remembers where the window is, then closes it. */
async function closeWindow() {
  try {
    const scale = await me.scaleFactor();
    const at = (await me.outerPosition()).toLogical(scale);
    const size = (await me.innerSize()).toLogical(scale);
    saveWindowBounds(dialog, { x: at.x, y: at.y, width: size.width, height: size.height });
  } catch {
    // It opens centred next time.
  }
  await me.destroy();
}

/**
 * A git dialog (commit, push) in a window of its own (src-tauri/src/floating.rs).
 * Its app window keeps the git state and does the git work (lib/gitWindow.ts).
 */
export default function GitWindow() {
  const settings = useAppearance();
  const [state, setState] = useState<GitWindowState | null>(null);
  // The commit message is the dialog's while it's typed: the window's copy can lag behind.
  const [message, setMessage] = useState("");
  const parent = useRef<string | null>(null);
  const pending = useRef(new Map<number, (done: boolean) => void>());
  const nextId = useRef(1);

  const send = useCallback((action: GitWindowAction) => {
    if (parent.current) void emitTo<GitWindowMessage>(parent.current, GIT_ACTION, { from: me.label, action });
  }, []);

  /** Sends a commit or push, and resolves to whether it went through. */
  const request = useCallback(
    (action: (id: number) => GitWindowAction) =>
      new Promise<boolean>((resolve) => {
        const id = nextId.current++;
        pending.current.set(id, resolve);
        send(action(id));
      }),
    [send],
  );

  const close = useCallback(() => {
    send({ type: "closed" });
    void closeWindow();
  }, [send]);

  useEffect(() => {
    let first = true;
    const unlisteners = [
      me.listen<GitWindowState>(GIT_STATE, ({ payload }) => {
        if (first || payload.external) setMessage(payload.message);
        first = false;
        setState(payload);
      }),
      me.listen<GitResult>(GIT_RESULT, ({ payload }) => {
        pending.current.get(payload.id)?.(payload.done);
        pending.current.delete(payload.id);
      }),
      me.onCloseRequested((e) => {
        e.preventDefault();
        close();
      }),
    ];
    // Listening now: the window can send the state.
    void Promise.all([...unlisteners, parentLabel]).then(([, , , label]) => {
      if (!label) return void closeWindow();
      parent.current = label as string;
      send({ type: "ready" });
    });
    return () => {
      for (const u of unlisteners) void u.then((f) => f());
    };
  }, [send, close]);

  // The folder isn't a repository any more.
  useEffect(() => {
    if (state && !state.status) void closeWindow();
  }, [state]);

  // ⌘W closes it, as any window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === "KeyW") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const unsaved = useMemo(() => new Set(state?.unsaved), [state?.unsaved]);
  if (!state?.status) return null;
  const status = state.status;
  const onOpenDiff = (target: DiffTarget, pin?: boolean) => send({ type: "open-diff", target, pin });

  return (
    <InOwnWindow.Provider value>
      {dialog === "push" ? (
        <PushDialog
          status={status}
          busy={state.busy}
          onPush={(remote) => request((id) => ({ type: "push", id, remote }))}
          onOpenDiff={onOpenDiff}
          onClose={close}
        />
      ) : (
        <CommitDialog
          status={status}
          busy={state.busy}
          version={state.version}
          message={message}
          onMessageChange={(m) => {
            setMessage(m);
            send({ type: "message", message: m });
          }}
          unsaved={unsaved}
          onStage={(paths) => send({ type: "stage", paths })}
          onUnstage={(paths) => send({ type: "unstage", paths })}
          onDiscard={(paths) => {
            void confirmDiscard(status.files, paths).then((sure) => sure && send({ type: "discard", paths }));
          }}
          onCommit={(push, options) => request((id) => ({ type: "commit", id, message, push, options }))}
          identity={state.identity}
          onOpenDiff={onOpenDiff}
          onOpenFile={(path) => send({ type: "open-file", path })}
          onClose={close}
          showAll={settings.gitShowAllFiles}
        />
      )}
    </InOwnWindow.Provider>
  );
}
