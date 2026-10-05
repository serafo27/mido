// The commit dialog in a window of its own (src-tauri/src/floating.rs). The
// app window keeps the git state and does the git work: it sends the state to
// the dialog's window, which sends back what the user asks for.
import { invoke } from "@tauri-apps/api/core";
import type { CommitOptions, GitStatus } from "./api";
import type { Author } from "./comments";
import type { DiffTarget } from "../components/SourceControl";

/** What the dialog shows. */
export interface CommitWindowState {
  /** Null once the folder isn't a repository any more: the window closes. */
  status: GitStatus | null;
  busy: string | null;
  version: string;
  message: string;
  /**
   * Whether the message changed other than by the dialog's typing (committed,
   * typed in the panel): the dialog takes it then, and otherwise keeps its own,
   * which may be ahead of this one.
   */
  external: boolean;
  unsaved: string[];
  identity: Author | null;
}

/** What the dialog asks of its window. */
export type CommitWindowAction =
  | { type: "ready" }
  | { type: "message"; message: string }
  | { type: "stage" | "unstage"; paths: string[] }
  /** Already confirmed in the dialog's window. */
  | { type: "discard"; paths: string[] }
  | { type: "commit"; id: number; message: string; push: boolean; options: CommitOptions }
  | { type: "open-diff"; target: DiffTarget; pin?: boolean }
  | { type: "open-file"; path: string }
  | { type: "closed" };

/** Window → dialog. */
export const COMMIT_STATE = "commit-window-state";
/** Dialog → window. */
export const COMMIT_ACTION = "commit-window-action";
/** Window → dialog: whether a commit went through. */
export const COMMIT_RESULT = "commit-window-result";
export interface CommitResult {
  id: number;
  done: boolean;
}

/** Where the window was last, to open it there again. */
const BOUNDS_KEY = "mido.commitWindow.bounds";
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function saveCommitWindowBounds(bounds: WindowBounds) {
  try {
    localStorage.setItem(BOUNDS_KEY, JSON.stringify(bounds));
  } catch {
    // Storage unavailable: it opens centred next time.
  }
}

function savedBounds(): WindowBounds | null {
  try {
    const b = JSON.parse(localStorage.getItem(BOUNDS_KEY) ?? "null") as WindowBounds | null;
    return b && [b.x, b.y, b.width, b.height].every(Number.isFinite) ? b : null;
  } catch {
    return null;
  }
}

/** Opens the commit dialog's window, or brings it to the front; resolves to its label. */
export const openCommitWindow = () => invoke<string>("open_commit_window", { bounds: savedBounds() });
/** In a floating window: the label of the app window it belongs to. */
export const windowParent = () => invoke<string | null>("window_parent");
