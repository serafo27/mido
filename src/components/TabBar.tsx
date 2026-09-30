import { useEffect, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import { basename, dirname } from "../lib/paths";

export interface TabInfo {
  path: string;
  dirty: boolean;
  preview: boolean;
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

  // Disambiguate tabs that share a file name with their parent folder.
  const names = tabs.map((t) => basename(t.path));
  const hint = (i: number) =>
    names.filter((n) => n === names[i]).length > 1 ? basename(dirname(tabs[i].path)) : null;

  return (
    // Empty strip space still drags the window when the tabs live in the title bar.
    <div className={`tab-strip ${embedded ? "embedded" : ""}`} data-tauri-drag-region={embedded || undefined}>
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
              tab.preview && "preview",
              dragIndex === i && "dragging",
              dropIndex === i && dragIndex !== null && dragIndex !== i && (dragIndex < i ? "drop-after" : "drop-before"),
            ]
              .filter(Boolean)
              .join(" ")}
            title={tab.preview ? `${tab.path}\nPreview — double-click to keep open` : tab.path}
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
            <FileText size={13} className="tab-icon" />
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
    </div>
  );
}
