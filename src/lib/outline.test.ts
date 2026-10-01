import { describe, expect, it } from "vitest";
import { MarkdownParser } from "./blockRenderer";
import { extractHeadings, headingAt } from "./outline";

const doc = (...lines: string[]) => lines.join("\n");

describe("extractHeadings", () => {
  it("finds ATX headings with their level and line", () => {
    expect(extractHeadings(doc("# One", "text", "### Three ###"))).toEqual([
      { level: 1, text: "One", line: 1 },
      { level: 3, text: "Three", line: 3 },
    ]);
  });

  it("finds setext headings", () => {
    expect(extractHeadings(doc("Title", "=====", "", "Sub", "---"))).toEqual([
      { level: 1, text: "Title", line: 1 },
      { level: 2, text: "Sub", line: 4 },
    ]);
  });

  it("doesn't mistake a list item followed by a rule for a heading", () => {
    expect(extractHeadings(doc("- item", "---"))).toEqual([]);
  });

  it("skips headings inside fenced code", () => {
    const src = doc("```sh", "# not a heading", "```", "~~~", "# nor this", "~~~", "# Real");
    expect(extractHeadings(src)).toEqual([{ level: 1, text: "Real", line: 7 }]);
  });

  it("only closes a fence with the same character and at least the same length", () => {
    const src = doc("````", "```", "# inside", "````", "# after");
    expect(extractHeadings(src).map((h) => h.text)).toEqual(["after"]);
  });

  it("skips frontmatter", () => {
    const src = doc("---", "title: x", "---", "# Body");
    expect(extractHeadings(src)).toEqual([{ level: 1, text: "Body", line: 4 }]);
  });

  it("strips inline Markdown from the text", () => {
    const src = "## **Bold** `code` [link](http://x) <b>html</b> \\*star";
    expect(extractHeadings(src)[0].text).toBe("Bold code link html *star");
  });

  it("keeps underscores inside words, but strips underscore emphasis", () => {
    const text = (src: string) => extractHeadings(src)[0].text;
    expect(text("# use snake_case and my_var_name")).toBe("use snake_case and my_var_name");
    expect(text("# file__name v1_2")).toBe("file__name v1_2");
    expect(text("# _emphasis_ and __strong__")).toBe("emphasis and strong");
    expect(text("# città_bella")).toBe("città_bella");
    expect(text("# intra*word*stars")).toBe("intrawordstars");
  });

  it("finds headings in block quotes and lists, as the preview shows them", () => {
    expect(extractHeadings(doc("> ## Quoted", "", "- # Listed"))).toEqual([
      { level: 2, text: "Quoted", line: 1 },
      { level: 1, text: "Listed", line: 3 },
    ]);
  });

  it("skips TOML frontmatter and indented code", () => {
    expect(extractHeadings(doc("+++", "a = 1", "+++", "", "    # code", "", "# Body"))).toEqual([
      { level: 1, text: "Body", line: 7 },
    ]);
  });

  it("follows the text through edits with a kept parser", () => {
    const parser = new MarkdownParser();
    expect(extractHeadings("# A\n\ntext", parser).map((h) => h.line)).toEqual([1]);
    expect(extractHeadings("\n\n# A\n\n## B", parser)).toEqual([
      { level: 1, text: "A", line: 3 },
      { level: 2, text: "B", line: 5 },
    ]);
  });

  it("requires a space after the hashes", () => {
    expect(extractHeadings("#hashtag")).toEqual([]);
  });

  it("handles Windows line endings", () => {
    expect(extractHeadings("# A\r\ntext\r\n## B")).toEqual([
      { level: 1, text: "A", line: 1 },
      { level: 2, text: "B", line: 3 },
    ]);
  });
});

describe("headingAt", () => {
  const headings = [
    { level: 1, text: "A", line: 3 },
    { level: 2, text: "B", line: 10 },
  ];

  it("returns the section containing the line", () => {
    expect(headingAt(headings, 3)).toBe(0);
    expect(headingAt(headings, 9)).toBe(0);
    expect(headingAt(headings, 10)).toBe(1);
    expect(headingAt(headings, 500)).toBe(1);
  });

  it("returns the first heading above all headings, and -1 without headings", () => {
    expect(headingAt(headings, 1)).toBe(0);
    expect(headingAt([], 1)).toBe(-1);
  });
});
