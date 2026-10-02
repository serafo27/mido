import { useCallback, useEffect, useRef, useState } from "react";
import { api, type GitFileChange, type GitRepo } from "./api";
import { isMarkdown } from "./paths";
import { isWeb } from "./platform";

/**
 * The repository the open folder is in, kept up to date: when the folder or
 * its files change, and when the window comes back to the front (a commit
 * made in Terminal doesn't touch the folder's files). Only reads: every git
 * action is the user's, through `run`.
 */
export function useGit(root: string | null, opened: unknown, enabled = true) {
  const [repo, setRepo] = useState<GitRepo | null>(null);
  // What's running ("Pushing…"), so the panel can show it and not start another.
  const [busy, setBusy] = useState<string | null>(null);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++request.current;
    // Off (an experimental feature), the repository isn't even read.
    if (!root || isWeb || !enabled) return setRepo(null);
    try {
      const info = await api.gitInfo();
      if (id === request.current) setRepo(info);
    } catch {
      // The folder isn't open in the backend yet: `opened` changing brings us back.
      if (id === request.current) setRepo(null);
    }
  }, [root, enabled]);

  useEffect(() => {
    refresh();
  }, [refresh, opened]);

  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  /** Runs a git action under `label`, then reads the status again, whatever happened. */
  const run = useCallback(
    async <T>(label: string, action: () => Promise<T>): Promise<T> => {
      setBusy(label);
      try {
        return await action();
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [refresh],
  );

  return { repo, refresh, busy, run };
}

/** A Markdown document, or one of Mido's comment files: what source control shows unless asked for everything. */
export const isDocumentPath = (path: string) => isMarkdown(path) || /(^|\/)\.mido\/comments\//.test(path);

/** The letter shown for a change, as in VS Code: U for untracked, ! for a conflict. */
export function changeLetter(change: Pick<GitFileChange, "staged" | "unstaged" | "conflicted">): string {
  if (change.conflicted) return "!";
  const code = change.unstaged ?? change.staged ?? "M";
  return code === "?" ? "U" : code;
}
