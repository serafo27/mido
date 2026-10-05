import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import CommitDialog from "./CommitDialog";
import { InOwnWindow } from "./FloatingDialog";
import {
  COMMIT_ACTION,
  COMMIT_RESULT,
  COMMIT_STATE,
  saveCommitWindowBounds,
  windowParent,
  type CommitResult,
  type CommitWindowAction,
  type CommitWindowState,
} from "../lib/commitWindow";
import { confirmDiscard } from "../lib/useGit";
import { useAppearance } from "../lib/useAppearance";
import { isMac } from "../lib/platform";

// Asked once, outside React.
const parentLabel = windowParent().catch(() => null);

/** Remembers where the window is, then closes it. */
async function closeWindow() {
  const me = getCurrentWindow();
  try {
    const scale = await me.scaleFactor();
    const at = (await me.outerPosition()).toLogical(scale);
    const size = (await me.innerSize()).toLogical(scale);
    saveCommitWindowBounds({ x: at.x, y: at.y, width: size.width, height: size.height });
  } catch {
    // It opens centred next time.
  }
  await me.destroy();
}

/**
 * The commit dialog in a window of its own (src-tauri/src/floating.rs). Its
 * app window keeps the git state and does the git work (lib/commitWindow.ts).
 */
export default function CommitWindow() {
  const settings = useAppearance();
  const [state, setState] = useState<CommitWindowState | null>(null);
  // The message is the dialog's while it's typed: the window's copy can lag behind.
  const [message, setMessage] = useState("");
  const parent = useRef<string | null>(null);
  const commits = useRef(new Map<number, (done: boolean) => void>());
  const nextCommit = useRef(1);

  const send = useCallback((action: CommitWindowAction) => {
    if (parent.current) void emitTo(parent.current, COMMIT_ACTION, action);
  }, []);

  const close = useCallback(() => {
    send({ type: "closed" });
    void closeWindow();
  }, [send]);

  useEffect(() => {
    const me = getCurrentWindow();
    let first = true;
    const unlisteners = [
      me.listen<CommitWindowState>(COMMIT_STATE, ({ payload }) => {
        if (first || payload.external) setMessage(payload.message);
        first = false;
        setState(payload);
      }),
      me.listen<CommitResult>(COMMIT_RESULT, ({ payload }) => {
        commits.current.get(payload.id)?.(payload.done);
        commits.current.delete(payload.id);
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

  return (
    <InOwnWindow.Provider value>
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
        onCommit={(push, options) =>
          new Promise<boolean>((resolve) => {
            const id = nextCommit.current++;
            commits.current.set(id, resolve);
            send({ type: "commit", id, message, push, options });
          })
        }
        identity={state.identity}
        onOpenDiff={(target, pin) => send({ type: "open-diff", target, pin })}
        onOpenFile={(path) => send({ type: "open-file", path })}
        onClose={close}
        showAll={settings.gitShowAllFiles}
      />
    </InOwnWindow.Provider>
  );
}
