import { useMemo } from "react";
import { documentStats } from "../lib/markdown";

interface StatusBarProps {
  content: string;
  dirty: boolean;
  saving: boolean;
  wrap: boolean;
  autosave: boolean;
  onWrap: () => void;
  onAutosave: () => void;
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
      <button onClick={props.onWrap}>{props.wrap ? "Wrap" : "No wrap"}</button>
      <button onClick={props.onAutosave}>Autosave {props.autosave ? "on" : "off"}</button>
      <span className={`save-state ${props.dirty ? "dirty" : ""}`}>{status}</span>
    </footer>
  );
}
