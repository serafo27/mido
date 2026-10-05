import { macWindowInset } from "../lib/platform";

interface MinimalBarProps {
  /** The open file's name; null when there's none (or a diff shows). */
  name: string | null;
  dirty: boolean;
  /** Over the editor alone (Edit mode): the bar takes its background. */
  editing: boolean;
}

/**
 * Minimal Mode's only bar: room to drag the window by (and for the macOS
 * window buttons), with the file's name, faint, and its unsaved dot.
 */
export default function MinimalBar({ name, dirty, editing }: MinimalBarProps) {
  return (
    <header
      className={`minimal-bar ${macWindowInset ? "mac-inset" : ""} ${editing ? "editing" : ""}`}
      data-tauri-drag-region
    >
      {name && (
        <span className="minimal-bar-name" data-tauri-drag-region>
          {name}
          {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        </span>
      )}
    </header>
  );
}
