// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { compareVersions, sanitizeNotes } from "./updates";

describe("compareVersions", () => {
  it("compares numerically, not as strings", () => {
    expect(compareVersions("0.10.0", "0.9.3")).toBe(1);
    expect(compareVersions("0.9.3", "0.10.0")).toBe(-1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
  });

  it("treats equal versions as equal, with or without a v prefix", () => {
    expect(compareVersions("v0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.2", "0.2.0")).toBe(0);
  });

  it("ignores pre-release suffixes", () => {
    expect(compareVersions("0.3.0-beta.1", "0.3.0")).toBe(0);
    expect(compareVersions("0.3.0-beta.1", "0.2.9")).toBe(1);
  });
});

describe("sanitizeNotes", () => {
  it("keeps simple formatting", () => {
    const html = "<h3>Added</h3><ul><li><strong>Bold</strong> and <code>code</code></li></ul>";
    expect(sanitizeNotes(html)).toBe(html);
  });

  it("removes scripts, event handlers and other tags, keeping their text", () => {
    const out = sanitizeNotes('<p onclick="x()">Hi <img src=x onerror="x()"><span>there</span></p><script>evil()</script>');
    expect(out).not.toMatch(/onclick|onerror|<img|<span|<script/);
    expect(out).toContain("Hi");
    expect(out).toContain("there");
  });

  it("keeps only https links", () => {
    expect(sanitizeNotes('<a href="https://example.com" target="_blank">ok</a>')).toBe(
      '<a href="https://example.com">ok</a>',
    );
    expect(sanitizeNotes('<a href="javascript:alert(1)">bad</a>')).toBe("<a>bad</a>");
    expect(sanitizeNotes('<a href="http://example.com">plain</a>')).toBe("<a>plain</a>");
  });

  it("handles nested disallowed tags", () => {
    expect(sanitizeNotes("<div><section><p>deep</p></section></div>")).toBe("<p>deep</p>");
  });
});
