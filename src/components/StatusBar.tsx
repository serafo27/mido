import { useMemo } from "react";
import { ArrowDown, ArrowUp, GitBranch, SquareTerminal } from "lucide-react";
import { documentStats } from "../lib/markdown";
import { isWeb, requireDesktop } from "../lib/platform";

interface StatusBarProps {
  content: string;
  dirty: boolean;
  saving: boolean;
  wrap: boolean;
  autosave: boolean;
  onWrap: () => void;
  onAutosave: () => void;
  terminalOpen: boolean;
  /** Shows or hides the terminal (in the web version, asks for the desktop app). */
  onTerminal: () => void;
  /** The repository's branch, when the folder is in one Mido may use git in. */
  git?: { branch: string | null; ahead: number; behind: number; changes: number; onClick: () => void } | null;
}

export default function StatusBar(props: StatusBarProps) {
  const stats = useMemo(() => documentStats(props.content), [props.content]);
  const status = props.saving ? "Saving…" : props.dirty ? "Unsaved" : "Saved";

  return (
    <footer className="statusbar">
      <span>{stats.words.toLocaleString()} words</span>
      <span>{stats.chars.toLocaleString()} chars</span>
      <span>{stats.lines.toLocaleString()} lines</span>
      <span>{stats.minutes} min read</span>
      <span className="spacer" />
      {props.git && (
        <button className="statusbar-git" onClick={props.git.onClick} title="Source control">
          <GitBranch size={12} />
          {props.git.branch ?? "Detached"}
          {props.git.changes > 0 && <span className="statusbar-git-dirty">*</span>}
          {props.git.behind > 0 && (
            <>
              <ArrowDown size={11} />
              {props.git.behind}
            </>
          )}
          {props.git.ahead > 0 && (
            <>
              <ArrowUp size={11} />
              {props.git.ahead}
            </>
          )}
        </button>
      )}
      <button
        className={`statusbar-terminal ${props.terminalOpen ? "active" : ""}`}
        onClick={props.onTerminal}
        title="Terminal (⌃`)"
        aria-pressed={props.terminalOpen}
      >
        <SquareTerminal size={12} />
        Terminal
      </button>
      <button onClick={props.onWrap}>{props.wrap ? "Wrap" : "No wrap"}</button>
      {isWeb ? (
        <button className="read-only-badge" onClick={() => requireDesktop("Editing")} title="Get the desktop app to edit">
          Read-only
        </button>
      ) : (
        <>
          <button onClick={props.onAutosave}>Autosave {props.autosave ? "on" : "off"}</button>
          <span className={`save-state ${props.dirty ? "dirty" : ""}`}>{status}</span>
        </>
      )}
    </footer>
  );
}
