/**
 * A theme colour as xterm.js (or the window behind the page) can read it. Theme variables
 * may be any CSS colour, including color-mix(), which they don't parse: painting it on a pixel
 * gives the plain colour back, as #rrggbb (or #rrggbbaa when see-through).
 */
let probe: CanvasRenderingContext2D | null | undefined;
export function plainColor(css: string): string | undefined {
  if (!css) return undefined;
  probe ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", {
    willReadFrequently: true,
  });
  if (!probe) return css;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}${a === 255 ? "" : hex(a)}`;
}
