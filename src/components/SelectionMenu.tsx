import { useEffect, useState, type RefObject } from "react";
import { MessageSquarePlus } from "lucide-react";
import { editorSelectionLine, type LineRect } from "./Editor";
import { altKey, modKey } from "../lib/platform";

interface SelectionMenuProps {
  /** Where selections count: the editor and the preview. */
  containerRef: RefObject<HTMLElement | null>;
  onComment: () => void;
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

/**
 * A small "Comment" button over text selected with the mouse, in the editor
 * or the preview. Selecting with the keyboard doesn't show it, so it stays
 * out of the way while typing.
 */
export default function SelectionMenu({ containerRef, onComment }: SelectionMenuProps) {
  const [line, setLine] = useState<LineRect | null>(null);

  useEffect(() => {
    let frame = 0;
    const onPointerUp = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest?.(".selection-menu")) return;
      const container = containerRef.current;
      if (!container?.contains(target)) return setLine(null);
      // Once the selection has settled (a double-click selects on the way up).
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setLine(editorSelectionLine() ?? previewSelectionLine(container)));
    };
    const onSelectionChange = () => {
      if (window.getSelection()?.isCollapsed && !editorSelectionLine()) setLine(null);
    };
    const hide = () => setLine(null);
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

  if (!line) return null;
  // Above the first selected line, or below it near the top of the window.
  const below = line.top < 90;
  const x = Math.min(Math.max((line.left + line.right) / 2, 70), window.innerWidth - 70);
  return (
    <div
      className={`selection-menu ${below ? "below" : ""}`}
      style={{ left: x, top: below ? line.bottom + 8 : line.top - 8 }}
    >
      <button
        // Keep the selection the comment is about.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setLine(null);
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
    </div>
  );
}
