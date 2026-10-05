// The git dialogs (commit, push) in windows of their own (src-tauri/src/floating.rs).
// The app window keeps the git state and does the git work: it sends the state
// to the dialog's window, which sends back what the user asks for.
import { invoke } from "@tauri-apps/api/core";
import type { CommitOptions, GitStatus } from "./api";
import type { Author } from "./comments";
import type { DiffTarget } from "../components/SourceControl";

export type GitDialog = "commit" | "push";

/** What the dialogs show. */
export interface GitWindowState {
  /** Null once the folder isn't a repository any more: the window closes. */
  status: GitStatus | null;
  busy: string | null;
  version: string;
  message: string;
  /**
   * Whether the message changed other than by the commit dialog's typing
   * (committed, typed in the panel): the dialog takes it then, and otherwise
   * keeps its own, which may be ahead of this one.
   */
  external: boolean;
  unsaved: string[];
  identity: Author | null;
}

/** What a dialog asks of its window. */
export type GitWindowAction =
  | { type: "ready" }
  | { type: "message"; message: string }
  | { type: "stage" | "unstage"; paths: string[] }
  /** Already confirmed in the dialog's window. */
  | { type: "discard"; paths: string[] }
  | { type: "commit"; id: number; message: string; push: boolean; options: CommitOptions }
  /** `remote` publishes the branch there; null pushes to its upstream. */
  | { type: "push"; id: number; remote: string | null }
  | { type: "open-diff"; target: DiffTarget; pin?: boolean }
  | { type: "open-file"; path: string }
  | { type: "closed" };

/** Dialog → window: an action, and the label of the dialog's window. */
export interface GitWindowMessage {
  from: string;
  action: GitWindowAction;
}

/** Window → dialog. */
export const GIT_STATE = "git-window-state";
/** Dialog → window. */
export const GIT_ACTION = "git-window-action";
/** Window → dialog: whether a commit or push went through. */
export const GIT_RESULT = "git-window-result";
export interface GitResult {
  id: number;
  done: boolean;
}

/** The dialog a window shows, from its label (`git-<dialog>-<n>`). */
export const dialogOf = (label: string): GitDialog => (label.startsWith("git-push-") ? "push" : "commit");

/** Where a dialog's window was last, to open it there again. */
const boundsKey = (dialog: GitDialog) => `mido.${dialog}Window.bounds`;
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function saveWindowBounds(dialog: GitDialog, bounds: WindowBounds) {
  try {
    localStorage.setItem(boundsKey(dialog), JSON.stringify(bounds));
  } catch {
    // Storage unavailable: it opens centred next time.
  }
}

function savedBounds(dialog: GitDialog): WindowBounds | null {
  try {
    const b = JSON.parse(localStorage.getItem(boundsKey(dialog)) ?? "null") as WindowBounds | null;
    return b && [b.x, b.y, b.width, b.height].every(Number.isFinite) ? b : null;
  } catch {
    return null;
  }
}

/** Opens a dialog's window, or brings it to the front; resolves to its label. */
export const openGitWindow = (dialog: GitDialog) =>
  invoke<string>("open_git_window", { dialog, bounds: savedBounds(dialog) });
/** In a floating window: the label of the app window it belongs to. */
export const windowParent = () => invoke<string | null>("window_parent");
