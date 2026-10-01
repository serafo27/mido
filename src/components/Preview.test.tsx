// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { previewLineAt, previewScrollTopFor, previewTopLine } from "./Preview";

/**
 * A preview whose blocks sit at fixed positions in its content (happy-dom
 * has no layout): `[tag, attributes, top]`, nested by `parent` index.
 */
function preview(blocks: { attrs: Record<string, string>; top: number; parent?: number; hidden?: boolean }[]) {
  const el = document.createElement("div");
  const article = document.createElement("article");
  article.dataset.sourceLines = "20";
  el.append(article);
  Object.defineProperty(el, "scrollHeight", { value: 1000 });
  Object.defineProperty(el, "clientHeight", { value: 300 });
  el.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  const elements: HTMLElement[] = [];
  for (const b of blocks) {
    const node = document.createElement("div");
    for (const [k, v] of Object.entries(b.attrs)) node.setAttribute(k, v);
    node.getBoundingClientRect = () => ({ top: b.top - el.scrollTop }) as DOMRect;
    node.getClientRects = () => (b.hidden ? [] : [{}]) as unknown as DOMRectList;
    (b.parent === undefined ? article : elements[b.parent]).append(node);
    elements.push(node);
  }
  return el;
}

const page = () =>
  preview([
    { attrs: { "data-line": "1" }, top: 40 },
    { attrs: { "data-line": "5" }, top: 200 },
    { attrs: { "data-line-offset": "2" }, top: 260, parent: 1 },
    { attrs: { "data-line-offset": "3" }, top: 280, parent: 1, hidden: true },
    { attrs: { "data-line": "10" }, top: 400 },
  ]);

describe("preview scroll positions", () => {
  it("interpolates the line at the top between the blocks around it", () => {
    const el = page();
    el.scrollTop = 230;
    // Between line 5 (at 200) and its nested line 7 (at 260).
    expect(previewLineAt(el)).toBeCloseTo(6);
    el.scrollTop = 330;
    expect(previewLineAt(el)).toBeCloseTo(8.5);
  });

  it("maps lines back to the same positions", () => {
    const el = page();
    for (const top of [0, 120, 230, 330, 520, 700]) {
      el.scrollTop = top;
      expect(previewScrollTopFor(el, previewLineAt(el))).toBeCloseTo(top);
    }
  });

  it("runs from the top of the page to the end of the last line", () => {
    const el = page();
    expect(previewScrollTopFor(el, 1)).toBe(0);
    expect(previewScrollTopFor(el, 21)).toBe(1000);
    // Past the last block: lines 10 to 21 span 400 to 1000.
    expect(previewScrollTopFor(el, 15.5)).toBeCloseTo(700);
  });

  it("skips hidden blocks", () => {
    const el = page();
    // Line 8 (hidden, at 280) isn't used: 7 → 10 spans 260 → 400.
    expect(previewScrollTopFor(el, 8.5)).toBeCloseTo(330);
  });

  it("counts the current line for the outline a little below the top", () => {
    const el = page();
    el.scrollTop = 120;
    expect(previewTopLine(el)).toBe(5);
  });
});
