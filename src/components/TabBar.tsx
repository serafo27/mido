import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, GitCompareArrows, Sparkles, X } from "lucide-react";
import { basename, dirname } from "../lib/paths";

export interface TabInfo {
  /** The file's path, or the tab's own key for a tab that isn't a file. */
  path: string;
  dirty: boolean;
  preview: boolean;
  /** A diff rather than a file (or a chat, with `chat`): its name. */
  diff?: { name: string; detail: string; title: string };
  /** An assistant's conversation. */
  chat?: boolean;
}

interface TabBarProps {
  tabs: TabInfo[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onPin: (path: string) => void;
  onClose: (path: string) => void;
  onMove: (from: number, to: number) => void;
  /** Rendered inside the title bar instead of its own row. */
  embedded?: boolean;
}

export default function TabBar({ tabs, activePath, onSelect, onPin, onClose, onMove, embedded }: TabBarProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // Which ends of the strip have tabs scrolled out of view.
  const [hidden, setHidden] = useState({ start: false, end: false });

  // Keep the active tab visible (adjusting scrollLeft directly: scrollIntoView
  // can interrupt scroll animations elsewhere in WebKit).
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>(".tab.active");
    if (!list || !tab) return;
    const left = tab.offsetLeft - list.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < list.scrollLeft) list.scrollLeft = left;
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
  }, [activePath, tabs.length]);

  // Track overflow on scroll, on resize (the window, or the arrows appearing)
  // and whenever the tabs change.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => {
      const max = list.scrollWidth - list.clientWidth;
      const next = { start: list.scrollLeft > 1, end: list.scrollLeft < max - 1 };
      setHidden((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    list.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", update);
    };
  }, [tabs]);

  const scrollBy = (direction: 1 | -1) => {
    const list = listRef.current;
    list?.scrollBy({ left: direction * list.clientWidth * 0.75, behavior: "smooth" });
  };
  const overflowing = hidden.start || hidden.end;

  // Disambiguate tabs that share a file name with their parent folder.
  const names = tabs.map((t) => t.diff?.name ?? basename(t.path));
  const hint = (i: number) =>
    tabs[i].diff?.detail ??
    (names.filter((n, j) => n === names[i] && !tabs[j].diff).length > 1 ? basename(dirname(tabs[i].path)) : null);

  return (
    // Empty strip space still drags the window when the tabs live in the title bar.
    <div className={`tab-strip ${embedded ? "embedded" : ""}`} data-tauri-drag-region={embedded || undefined}>
      {overflowing && (
        <button className="tab-scroll" title="Scroll tabs left" disabled={!hidden.start} onClick={() => scrollBy(-1)}>
          <ChevronLeft size={14} />
        </button>
      )}
      <div
        className="tabs"
        ref={listRef}
        data-tauri-drag-region={embedded || undefined}
        role="tablist"
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {tabs.map((tab, i) => (
          <div
            key={tab.path}
            role="tab"
            aria-selected={tab.path === activePath}
            className={[
              "tab",
              tab.path === activePath && "active",
              tab.dirty && "dirty",
              tab.preview && "transient",
              dragIndex === i && "dragging",
              dropIndex === i && dragIndex !== null && dragIndex !== i && (dragIndex < i ? "drop-after" : "drop-before"),
            ]
              .filter(Boolean)
              .join(" ")}
            title={(tab.diff?.title ?? tab.path) + (tab.preview ? "\nPreview — double-click to keep open" : "")}
            draggable
            onMouseDown={(e) => {
              if (e.button === 0) onSelect(tab.path);
            }}
            onDoubleClick={() => onPin(tab.path)}
            onAuxClick={(e) => {
              if (e.button === 1) onClose(tab.path);
            }}
            onDragStart={(e) => {
              setDragIndex(i);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", tab.path);
            }}
            onDragOver={(e) => {
              if (dragIndex === null) return;
              e.preventDefault();
              setDropIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== i) onMove(dragIndex, i);
              setDragIndex(null);
              setDropIndex(null);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setDropIndex(null);
            }}
          >
            {tab.chat ? (
              <Sparkles size={13} className="tab-icon" />
            ) : tab.diff ? (
              <GitCompareArrows size={13} className="tab-icon" />
            ) : (
              <FileText size={13} className="tab-icon" />
            )}
            <span className="tab-name">{names[i]}</span>
            {hint(i) && <span className="tab-hint">{hint(i)}</span>}
            <button
              className="tab-close"
              title="Close tab"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.path);
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      {overflowing && (
        <button className="tab-scroll" title="Scroll tabs right" disabled={!hidden.end} onClick={() => scrollBy(1)}>
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}
