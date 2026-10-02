import { describe, expect, it } from "vitest";
import { findConflicts, resolution, resolveAll } from "./conflicts";

const text = [
  "# Title",
  "<<<<<<< HEAD",
  "ours one",
  "ours two",
  "=======",
  "theirs",
  ">>>>>>> feature",
  "middle",
  "<<<<<<< HEAD",
  "a",
  "||||||| base",
  "b",
  "=======",
  "c",
  ">>>>>>> 1a2b3c (Message)",
  "end",
].join("\n");

describe("findConflicts", () => {
  it("finds each block with its sides and labels", () => {
    const conflicts = findConflicts(text);
    expect(conflicts.map((c) => [c.oursLabel, c.ours, c.base, c.theirs, c.theirsLabel])).toEqual([
      ["HEAD", "ours one\nours two\n", null, "theirs\n", "feature"],
      ["HEAD", "a\n", "b\n", "c\n", "1a2b3c (Message)"],
    ]);
    expect(text.slice(conflicts[0].from, conflicts[0].to)).toMatch(/^<<<<<<< HEAD\n[\s\S]*>>>>>>> feature\n$/);
  });

  it("ignores unfinished blocks and look-alike lines", () => {
    expect(findConflicts("<<<<<<< HEAD\nours\n=======\ntheirs\n")).toEqual([]);
    expect(findConflicts("<<<<<<<< not a marker\n=======\n>>>>>>> x\n")).toEqual([]);
    // A setext heading underline isn't a separator outside a conflict.
    expect(findConflicts("Title\n=======\n")).toEqual([]);
  });

  it("handles a block at the end without a newline", () => {
    const block = "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x";
    const [conflict] = findConflicts(block);
    expect([conflict.ours, conflict.theirs, conflict.to]).toEqual(["a\n", "b\n", block.length]);
  });
});

describe("resolving", () => {
  it("keeps one side or both", () => {
    const [first] = findConflicts(text);
    expect(resolution(first, "ours")).toBe("ours one\nours two\n");
    expect(resolution(first, "theirs")).toBe("theirs\n");
    expect(resolution(first, "both")).toBe("ours one\nours two\ntheirs\n");
  });

  it("resolves every block at once", () => {
    expect(resolveAll(text, "theirs")).toBe("# Title\ntheirs\nmiddle\nc\nend");
  });
});
