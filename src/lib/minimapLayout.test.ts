import { describe, expect, it } from "vitest";
import { LineKind, layoutLines, lineAtY, wrapRows, yOfLine } from "./minimapLayout";

const metrics = { lineHeight: 20, charWidth: 10, wrapWidth: 100, paddingTop: 40, paddingBottom: 300 };

describe("wrapRows", () => {
  it("breaks after spaces, moving a word that doesn't fit to the next row", () => {
    expect(wrapRows("aaaa bbbb cccc", 10)).toEqual([
      [0, 10],
      [10, 14],
    ]);
    expect(wrapRows("short", 10)).toEqual([[0, 5]]);
  });

  it("breaks after a hyphen inside a word, not after a list marker", () => {
    expect(wrapRows("aa well-known", 9)).toEqual([
      [0, 8],
      [8, 13],
    ]);
    expect(wrapRows("- abcdefghij", 6)).toEqual([
      [0, 2],
      [2, 8],
      [8, 12],
    ]);
  });

  it("breaks inside a word longer than a row", () => {
    expect(wrapRows("abcdefghijklmnopqrstuvwxy", 10)).toEqual([
      [0, 10],
      [10, 20],
      [20, 25],
    ]);
  });
});

describe("layoutLines", () => {
  it("gives wrapped lines more rows, headings bigger rows, and adds the padding", () => {
    const layout = layoutLines(["# Title", "x".repeat(25), "", "short"], metrics);
    expect([...layout.heights]).toEqual([26, 60, 20, 20]);
    expect([...layout.tops]).toEqual([40, 66, 126, 146]);
    expect(layout.height).toBe(166 + 300);
  });

  it("doesn't wrap when wrapping is off", () => {
    expect([...layoutLines(["x".repeat(500)], { ...metrics, wrapWidth: null }).heights]).toEqual([20]);
  });

  it("marks fenced code, including a # line inside it, and headings outside it", () => {
    const layout = layoutLines(["## A", "```", "# not a heading", "```", "text", "~~~~", "```", "~~~~"], metrics);
    expect([...layout.kinds]).toEqual([
      LineKind.Heading,
      LineKind.Code,
      LineKind.Code,
      LineKind.Code,
      LineKind.Text,
      LineKind.Code,
      LineKind.Code,
      LineKind.Code,
    ]);
  });

  it("maps positions to lines and back", () => {
    const layout = layoutLines(["a", "x".repeat(25), "b"], metrics);
    expect(lineAtY(layout, 0)).toBe(0);
    expect(lineAtY(layout, 90)).toBe(1.5);
    expect(yOfLine(layout, 1.5)).toBe(90);
    expect(yOfLine(layout, lineAtY(layout, 123))).toBe(123);
  });
});
