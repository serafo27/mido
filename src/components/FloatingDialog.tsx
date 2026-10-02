import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useStoredState } from "../lib/useStoredState";

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FloatingDialogProps {
  /** Where its position and size are remembered. */
  storageKey: string;
  size: { width: number; height: number };
  minSize: { width: number; height: number };
  className?: string;
  label: string;
  /** The title bar's content: dragging the bar moves the dialog. */
  header: ReactNode;
  children: ReactNode;
  /** The red button, as on a macOS window. */
  onClose: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}

const MARGIN = 8;
type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const EDGES: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/** Kept inside the window, at least its minimum size, at most the window's. */
function fit(b: Bounds, min: { width: number; height: number }): Bounds {
  const maxW = window.innerWidth - MARGIN * 2;
  const maxH = window.innerHeight - MARGIN * 2;
  const width = Math.min(Math.max(b.width, Math.min(min.width, maxW)), maxW);
  const height = Math.min(Math.max(b.height, Math.min(min.height, maxH)), maxH);
  return {
    width,
    height,
    x: Math.min(Math.max(b.x, MARGIN), window.innerWidth - width - MARGIN),
    y: Math.min(Math.max(b.y, MARGIN), window.innerHeight - height - MARGIN),
  };
}

function centered(size: { width: number; height: number }): Bounds {
  const width = Math.min(size.width, window.innerWidth - 48);
  const height = Math.min(size.height, window.innerHeight - 48);
  return { width, height, x: (window.innerWidth - width) / 2, y: (window.innerHeight - height) / 2 };
}

/** A dialog that moves by its title bar and resizes from its edges, like a window. */
export default function FloatingDialog(props: FloatingDialogProps) {
  const [stored, setStored] = useStoredState<Bounds | null>(props.storageKey, null);
  const bounds = fit(stored ?? centered(props.size), props.minSize);
  const latest = useRef(bounds);
  latest.current = bounds;
  const dialog = useRef<HTMLDivElement>(null);
  // Where the green button brings it back to after filling the window.
  const beforeZoom = useRef<Bounds | null>(null);
  const zoomed = bounds.width >= window.innerWidth - MARGIN * 2 && bounds.height >= window.innerHeight - MARGIN * 2;
  const zoom = () => {
    if (zoomed && beforeZoom.current) {
      setStored(beforeZoom.current);
      beforeZoom.current = null;
    } else {
      beforeZoom.current = latest.current;
      setStored(fit({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }, props.minSize));
    }
  };

  // A smaller window brings the dialog back inside it.
  useEffect(() => {
    const onResize = () => setStored(fit(latest.current, props.minSize));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setStored, props.minSize]);

  useEffect(() => {
    dialog.current?.focus();
  }, []);

  /** Follows the pointer until it's released, with `apply` turning the movement into bounds. */
  const track = (e: ReactPointerEvent, cursor: string, apply: (start: Bounds, dx: number, dy: number) => Bounds) => {
    e.preventDefault();
    const start = latest.current;
    const [x0, y0] = [e.clientX, e.clientY];
    document.body.style.cursor = cursor;
    document.body.classList.add("dragging-dialog");
    const move = (ev: PointerEvent) => setStored(fit(apply(start, ev.clientX - x0, ev.clientY - y0), props.minSize));
    const up = () => {
      document.body.style.cursor = "";
      document.body.classList.remove("dragging-dialog");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startMove = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, select, textarea, a")) return;
    track(e, "grabbing", (s, dx, dy) => ({ ...s, x: s.x + dx, y: s.y + dy }));
  };

  const startResize = (edge: Edge) => (e: ReactPointerEvent) => {
    e.stopPropagation();
    const min = props.minSize;
    track(e, `${edge}-resize`, (s, dx, dy) => {
      let { x, y, width, height } = s;
      if (edge.includes("e")) width = s.width + dx;
      if (edge.includes("s")) height = s.height + dy;
      if (edge.includes("w")) {
        width = Math.max(s.width - dx, min.width);
        x = s.x + s.width - width;
      }
      if (edge.includes("n")) {
        height = Math.max(s.height - dy, min.height);
        y = s.y + s.height - height;
      }
      return { x, y, width, height };
    });
  };

  return (
    <div className="modal-backdrop floating">
      <div
        ref={dialog}
        className={`git-dialog floating ${props.className ?? ""}`}
        role="dialog"
        aria-label={props.label}
        tabIndex={-1}
        onKeyDown={props.onKeyDown}
        style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
      >
        <header className="git-dialog-header draggable" onPointerDown={startMove} onDoubleClick={() => setStored(null)}>
          {/* The window buttons, on the left as on every macOS window: close, (no) minimize, zoom. */}
          <div className="window-lights" onDoubleClick={(e) => e.stopPropagation()}>
            <button className="window-light close" title="Close (Esc)" aria-label="Close" onClick={props.onClose}>
              <svg viewBox="0 0 8 8" aria-hidden>
                <path d="M2 2l4 4M6 2L2 6" />
              </svg>
            </button>
            <button className="window-light minimize" disabled aria-label="Minimize" tabIndex={-1}>
              <svg viewBox="0 0 8 8" aria-hidden>
                <path d="M1.5 4h5" />
              </svg>
            </button>
            <button
              className="window-light zoom"
              title={zoomed ? "Restore" : "Fill the Window"}
              aria-label={zoomed ? "Restore" : "Fill the Window"}
              onClick={zoom}
            >
              <svg viewBox="0 0 8 8" aria-hidden>
                <path d={zoomed ? "M4.5 1v2.5H7M3.5 7V4.5H1" : "M1.5 4.5v2h2M6.5 3.5v-2h-2"} />
              </svg>
            </button>
          </div>
          {props.header}
        </header>
        {props.children}
        {EDGES.map((edge) => (
          <div key={edge} className={`resize-handle ${edge}`} onPointerDown={startResize(edge)} />
        ))}
      </div>
    </div>
  );
}
