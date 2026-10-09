import { useEffect, useState, type ReactNode, type RefObject } from "react";
import type { Command } from "@codemirror/view";
import { Bold, Code, Italic, Link, List, MessageSquarePlus, Sparkles, Strikethrough, TextQuote } from "lucide-react";
import { activeEditor, editorSelectionLine, type LineRect } from "./Editor";
import {
  formatAt,
  insertLink,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleList,
  toggleStrikethrough,
  type FormatState,
} from "../lib/formatting";
import { altKey, modKey } from "../lib/platform";

interface SelectionMenuProps {
  /** Where selections count: the editor and the preview. */
  containerRef: RefObject<HTMLElement | null>;
  onComment: () => void;
  /** Asks the assistant about the selection; absent when there's no assistant. */
  onAskAi?: () => void;
}

/** The first line of the text selected in the preview, if any. */
function previewSelectionLine(container: HTMLElement): LineRect | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const first = [...range.getClientRects()].find((r) => r.width > 0);
  return first ? { left: first.left, right: first.right, top: first.top, bottom: first.bottom } : null;
}

/** Where the selection is: text being written (the editor) or read (the preview). */
type Place = { line: LineRect; in: "editor" | "preview" };

/** The selection's place, if something is selected in the editor or the preview. */
function selectionPlace(container: HTMLElement): Place | null {
  const editor = editorSelectionLine();
  if (editor) return { line: editor, in: "editor" };
  const preview = previewSelectionLine(container);
  return preview && { line: preview, in: "preview" };
}

/** Keeps the selection when a button is pressed. */
const keepSelection = (e: React.MouseEvent) => e.preventDefault();

function FormatButton(props: { title: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className={props.active ? "active" : ""}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.active}
      onMouseDown={keepSelection}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/**
 * A small menu over text selected with the mouse: formatting where the
 * document is written (the editor), "Comment" where it's read (the
 * preview), and "Ask" the assistant in both. Selecting with the keyboard
 * doesn't show it, so it stays out of the way while typing.
 */
export default function SelectionMenu({ containerRef, onComment, onAskAi }: SelectionMenuProps) {
  const [place, setPlace] = useState<Place | null>(null);
  const line = place?.line ?? null;

  useEffect(() => {
    let frame = 0;
    const onPointerUp = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest?.(".selection-menu")) return;
      const container = containerRef.current;
      if (!container?.contains(target)) return setPlace(null);
      // Once the selection has settled (a double-click selects on the way up).
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setPlace(selectionPlace(container)));
    };
    const onSelectionChange = () => {
      if (window.getSelection()?.isCollapsed && !editorSelectionLine()) setPlace(null);
    };
    const hide = () => setPlace(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (!["Shift", "Meta", "Control", "Alt"].includes(e.key)) hide();
    };
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKeyDown, true);
    // Scrolling anything (the preview, the editor) moves the text away from the button.
    document.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, [containerRef]);

  if (!place || !line) return null;
  // Above the first selected line, or below it near the top of the window.
  const below = line.top < 90;
  // Kept over the document (not the sidebar), by about half the menu's width.
  const half = (place.in === "editor" ? 125 : 70) + (onAskAi ? (place.in === "editor" ? 18 : 40) : 0);
  const bounds = containerRef.current?.getBoundingClientRect();
  const minX = (bounds?.left ?? 0) + half;
  const maxX = Math.max(minX, (bounds?.right ?? window.innerWidth) - half);
  const x = Math.min(Math.max((line.left + line.right) / 2, minX), maxX);
  const style = { left: x, top: below ? line.bottom + 8 : line.top - 8 };

  if (place.in === "editor") {
    const view = activeEditor();
    const format: FormatState | null = view && formatAt(view.state);
    /** Formats the selection, and keeps the menu over it (where it is now). */
    const run = (command: Command) => {
      const view = activeEditor();
      if (!view) return;
      command(view);
      view.focus();
      requestAnimationFrame(() => {
        const next = editorSelectionLine();
        setPlace(next && { line: next, in: "editor" });
      });
    };
    return (
      <div className={`selection-menu format ${below ? "below" : ""}`} style={style} role="toolbar" aria-label="Format">
        <FormatButton title={`Bold (${modKey}B)`} active={!!format?.bold} onClick={() => run(toggleBold)}>
          <Bold size={14} />
        </FormatButton>
        <FormatButton title={`Italic (${modKey}I)`} active={!!format?.italic} onClick={() => run(toggleItalic)}>
          <Italic size={14} />
        </FormatButton>
        <FormatButton
          title={`Strikethrough (${modKey}⇧X)`}
          active={!!format?.strikethrough}
          onClick={() => run(toggleStrikethrough)}
        >
          <Strikethrough size={14} />
        </FormatButton>
        <FormatButton title="Inline code" active={!!format?.code} onClick={() => run(toggleInlineCode)}>
          <Code size={14} />
        </FormatButton>
        <span className="selection-menu-sep" />
        <FormatButton title={`Link (${modKey}K)`} active={!!format?.link} onClick={() => run(insertLink)}>
          <Link size={14} />
        </FormatButton>
        <FormatButton
          title="Bulleted list"
          active={format?.list === "bullet"}
          onClick={() => run(toggleList("bullet"))}
        >
          <List size={14} />
        </FormatButton>
        <FormatButton title="Quote" active={format?.list === "quote"} onClick={() => run(toggleList("quote"))}>
          <TextQuote size={14} />
        </FormatButton>
        {onAskAi && (
          <>
            <span className="selection-menu-sep" />
            <FormatButton
              title={`Ask the assistant about it (${altKey}${modKey}L)`}
              active={false}
              onClick={() => {
                setPlace(null);
                onAskAi();
              }}
            >
              <Sparkles size={14} />
            </FormatButton>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`selection-menu ${below ? "below" : ""}`} style={style}>
      <button
        // Keep the selection the comment is about.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setPlace(null);
          onComment();
        }}
        title={`Comment (${altKey}${modKey}M)`}
      >
        <MessageSquarePlus size={14} />
        <span>Comment</span>
        <kbd>
          {altKey}
          {modKey}M
        </kbd>
      </button>
      {onAskAi && (
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setPlace(null);
            onAskAi();
          }}
          title={`Ask the assistant about it (${altKey}${modKey}L)`}
        >
          <Sparkles size={14} />
          <span>Ask</span>
        </button>
      )}
    </div>
  );
}
