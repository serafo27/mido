import { describe, expect, it } from "vitest";
import type { LineMatch } from "../lib/api";
import { search } from "./search";

const opts = { caseSensitive: false, wholeWord: false };
const hits = (m: LineMatch) => m.ranges.map(([s, e]) => m.text.slice(s, e));

describe("web search", () => {
  it("finds matches case-insensitively by default", () => {
    const r = search(
      [
        { path: "/n/a.md", text: "# Title\nHello world\nhello again, HELLO" },
        { path: "/n/b.md", text: "nothing here" },
      ],
      "hello",
      opts,
    );
    expect(r.files).toHaveLength(1);
    expect(r.files[0].matches.map((m) => m.line)).toEqual([2, 3]);
    expect(hits(r.files[0].matches[1])).toEqual(["hello", "HELLO"]);
    expect(r.truncated).toBe(false);
  });

  it("respects match case and whole word", () => {
    const docs = [{ path: "/a.md", text: "Note notes NOTE note città_x città" }];
    expect(hits(search(docs, "note", { caseSensitive: true, wholeWord: false }).files[0].matches[0])).toEqual(["note", "note"]);
    expect(hits(search(docs, "note", { caseSensitive: false, wholeWord: true }).files[0].matches[0])).toEqual(["Note", "NOTE", "note"]);
    expect(hits(search(docs, "città", { caseSensitive: false, wholeWord: true }).files[0].matches[0])).toEqual(["città"]);
  });

  it("matches the query literally", () => {
    const docs = [{ path: "/a.md", text: "a.b axb (x) [y]" }];
    expect(hits(search(docs, "a.b", opts).files[0].matches[0])).toEqual(["a.b"]);
    expect(hits(search(docs, "(x)", opts).files[0].matches[0])).toEqual(["(x)"]);
  });

  it("trims lines and handles Windows line endings", () => {
    const m = search([{ path: "/a.md", text: "x\r\n   indented match  \r\n" }], "match", opts).files[0].matches[0];
    expect(m).toEqual({ line: 2, text: "indented match", ranges: [[9, 14]] });
  });

  it("cuts long lines around the first match", () => {
    const text = `${"x".repeat(500)}needle${"y".repeat(500)}`;
    const m = search([{ path: "/a.md", text }], "needle", opts).files[0].matches[0];
    expect(m.text.startsWith("…") && m.text.endsWith("…")).toBe(true);
    expect(m.text.length).toBe(242);
    expect(hits(m)).toEqual(["needle"]);
  });

  it("stops at the match limit", () => {
    const r = search(
      [
        { path: "/a.md", text: "match\n".repeat(1010) },
        { path: "/b.md", text: "match" },
      ],
      "match",
      opts,
    );
    expect(r.files).toHaveLength(1);
    expect(r.files[0].matches).toHaveLength(1000);
    expect(r.truncated).toBe(true);
  });

  it("ignores blank queries", () => {
    expect(search([{ path: "/a.md", text: "   " }], "  ", opts).files).toEqual([]);
  });
});
