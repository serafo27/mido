import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Heading } from "../lib/outline";

interface OutlineProps {
  headings: Heading[];
  activeIndex: number;
  onSelect: (heading: Heading) => void;
  onClose: () => void;
}

export default function Outline({ headings, activeIndex, onSelect, onClose }: OutlineProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const minLevel = headings.reduce((m, h) => Math.min(m, h.level), 6);

  // Keep the current section visible in long outlines. This adjusts only the
  // list's own scrollTop: scrollIntoView() would make WebKit abort the
  // preview's in-flight scroll animation started by the same click.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>(".outline-item.active");
    if (!list || !item) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - 8;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 8;
  }, [activeIndex]);

  return (
    <aside className="outline" aria-label="Outline">
      <header className="outline-header">
        <span>Outline</span>
        {headings.length > 0 && <span className="outline-count">{headings.length}</span>}
        <button className="icon-button" onClick={onClose} title="Close outline">
          <X size={14} />
        </button>
      </header>
      <nav className="outline-list" ref={listRef}>
        {headings.length === 0 && <div className="outline-empty">No headings in this document</div>}
        {headings.map((h, i) => (
          <button
            key={`${h.line}:${h.text}`}
            className={`outline-item level-${h.level - minLevel + 1} ${i === activeIndex ? "active" : ""}`}
            style={{ paddingLeft: 14 + (h.level - minLevel) * 13 }}
            // Don't steal focus from the editor: the click moves its cursor instead.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(h)}
            title={h.text}
          >
            {h.text}
          </button>
        ))}
      </nav>
    </aside>
  );
}
