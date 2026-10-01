import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import type { ScrollMarker } from "./ScrollMarkers";

export const MINIMAP_WIDTH = 96;

/**
 * The content a minimap shows, when it isn't the scroller's own content
 * scaled down: its height, and how positions map between the two.
 */
export interface MinimapSpace {
  height: number;
  /** The content position shown at a scroll position of the scroller. */
  fromScroll: (scrollTop: number) => number;
  /** The scroll position that shows a content position. */
  toScroll: (y: number) => number;
}

const SAME_SPACE = { fromScroll: (top: number) => top, toScroll: (y: number) => y };

interface MinimapProps {
  /** The element that scrolls: the preview, or the editor's scroller. */
  scroller: HTMLElement | null;
  /** Minimap pixels per pixel of content. */
  scale: number;
  /** The content drawn, if it isn't the scroller's. */
  space?: MinimapSpace;
  /**
   * Draws the minimap's visible part: `offset` is how far down the scaled
   * content it starts. Used by the editor, which can't be copied.
   */
  draw?: (ctx: CanvasRenderingContext2D, offset: number, width: number, height: number) => void;
  /** Bumped whenever what `draw` draws changes. */
  version?: unknown;
  /** Otherwise, the scaled content itself (the preview's page). */
  children?: ReactNode;
  markers: ScrollMarker[];
  onSelectMarker: (id: string) => void;
}

interface Geometry {
  /** Scroll position of the scroller. */
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  /** The minimap's own height. */
  height: number;
}

/**
 * A minimap in place of the scrollbar, like VS Code's: the whole document in
 * small, with the visible part framed. Click to jump, drag the frame to
 * scroll. Content taller than the minimap scrolls along with the document.
 */
export default function Minimap(props: MinimapProps) {
  const { scroller, scale, space, draw, version, children, markers, onSelectMarker } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [geometry, setGeometry] = useState<Geometry>({ scrollTop: 0, scrollHeight: 1, clientHeight: 1, height: 1 });

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!scroller || !root) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setGeometry((prev) => {
          const next = {
            scrollTop: scroller.scrollTop,
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
            height: root.clientHeight,
          };
          const same = (Object.keys(next) as (keyof Geometry)[]).every((k) => prev[k] === next[k]);
          return same ? prev : next;
        }),
      );
    };
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(root);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [scroller]);

  const { scrollTop, scrollHeight, clientHeight, height } = geometry;
  const { fromScroll, toScroll } = space ?? SAME_SPACE;
  const contentHeight = space?.height ?? scrollHeight;
  // Where the top of the view is in the content.
  const position = fromScroll(scrollTop);
  const scrollable = Math.max(0, contentHeight - clientHeight);
  const ratio = scrollable ? Math.min(1, Math.max(0, position / scrollable)) : 0;
  // When the scaled content is taller than the minimap, it scrolls too.
  const maxOffset = Math.max(0, contentHeight * scale - height);
  const offset = maxOffset * ratio;
  const sliderTop = position * scale - offset;
  const sliderHeight = Math.max(12, clientHeight * scale);
  // How far the frame travels over the whole scroll.
  const travel = scrollable * scale - maxOffset;

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!draw || !canvas || !root) return;
    const dpr = window.devicePixelRatio || 1;
    const width = root.clientWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    draw(ctx, offset, width, height);
  }, [draw, version, offset, height]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!scroller || e.button !== 0 || (e.target as HTMLElement).closest(".minimap-marker")) return;
    e.preventDefault();
    const root = e.currentTarget;
    const y = e.clientY - root.getBoundingClientRect().top;
    // Clicking outside the frame first centres the document on that point.
    let start = position;
    if (y < sliderTop || y > sliderTop + sliderHeight) {
      start = (y + offset) / scale - clientHeight / 2;
      scroller.scrollTop = toScroll(start);
    }
    if (travel <= 0) return;
    const startY = e.clientY;
    root.setPointerCapture(e.pointerId);
    root.classList.add("dragging");
    const move = (ev: globalThis.PointerEvent) => {
      scroller.scrollTop = toScroll(start + ((ev.clientY - startY) * scrollable) / travel);
    };
    const up = () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      root.classList.remove("dragging");
    };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
  };

  // The minimap sits beside the scroller, not in it: scrolling over it scrolls the document.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!scroller) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroller.clientHeight : 1;
    scroller.scrollBy({ left: e.deltaX * unit, top: e.deltaY * unit });
  };

  return (
    <div
      className="minimap"
      ref={rootRef}
      style={{ width: MINIMAP_WIDTH }}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
      aria-hidden
    >
      {draw ? (
        <canvas ref={canvasRef} />
      ) : (
        <div className="minimap-content" style={{ transform: `translateY(${-offset}px)` }}>
          {children}
        </div>
      )}
      <div className="minimap-slider" style={{ top: sliderTop, height: sliderHeight }} />
      {markers.map((m) => (
        <button
          key={m.id}
          className={`minimap-marker ${m.active ? "active" : ""}`}
          style={{ top: fromScroll(m.top * scrollHeight) * scale - offset }}
          tabIndex={-1}
          title="Show comment"
          onClick={() => onSelectMarker(m.id)}
        />
      ))}
    </div>
  );
}
