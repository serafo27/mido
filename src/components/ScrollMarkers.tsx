export interface ScrollMarker {
  id: string;
  /** Position in the scrollable content, from 0 (top) to 1 (bottom). */
  top: number;
  active: boolean;
}

interface ScrollMarkersProps {
  markers: ScrollMarker[];
  onSelect: (id: string) => void;
}

/**
 * Ticks along the right edge of a pane, beside its scrollbar, where comment
 * threads are: where the comments are at a glance, and a click away.
 */
export default function ScrollMarkers({ markers, onSelect }: ScrollMarkersProps) {
  if (markers.length === 0) return null;
  return (
    <div className="scroll-markers" aria-hidden>
      {markers.map((m) => (
        <button
          key={m.id}
          className={m.active ? "active" : ""}
          style={{ top: `${Math.min(Math.max(m.top, 0), 1) * 100}%` }}
          tabIndex={-1}
          title="Show comment"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(m.id)}
        />
      ))}
    </div>
  );
}

/** Whether two marker lists show the same thing, to skip needless renders. */
export function sameMarkers(a: ScrollMarker[], b: ScrollMarker[]): boolean {
  return (
    a.length === b.length &&
    a.every((m, i) => m.id === b[i].id && m.active === b[i].active && Math.abs(m.top - b[i].top) < 0.001)
  );
}
