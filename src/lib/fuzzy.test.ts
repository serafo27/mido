import { describe, expect, it } from "vitest";
import { fuzzyMatch, matchFile } from "./fuzzy";

const rank = (query: string, paths: string[]) =>
  paths
    .map((p) => ({ p, m: matchFile(query, p) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m!.score - a.m!.score)
    .map((x) => x.p);

describe("fuzzyMatch", () => {
  it("matches characters in order, ignoring case and spaces", () => {
    expect(fuzzyMatch("rdm", "README.md")?.indices).toEqual([0, 3, 4]);
    expect(fuzzyMatch("read me", "README.md")).not.toBeNull();
    expect(fuzzyMatch("mdr", "README.md")).toBeNull();
    expect(fuzzyMatch("x", "README.md")).toBeNull();
  });

  it("matches everything with an empty query", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
  });

  it("prefers word starts and consecutive characters", () => {
    // "gs" should pick the word starts of "getting-started", not the "g" inside "getting".
    expect(fuzzyMatch("gs", "getting-started.md")?.indices).toEqual([0, 8]);
    expect(fuzzyMatch("ab", "xab-a-b")!.score).toBeGreaterThan(fuzzyMatch("ab", "xa-xxb")!.score);
  });
});

describe("matchFile", () => {
  it("prefers matches in the file name over the folders", () => {
    expect(rank("notes", ["notes/todo.md", "archive/notes.md"])).toEqual(["archive/notes.md", "notes/todo.md"]);
  });

  it("ranks shorter and tighter names first", () => {
    expect(rank("todo", ["docs/photos-todo-list.md", "todo.md", "t-o-d-o.md"])).toEqual([
      "todo.md",
      "docs/photos-todo-list.md",
      "t-o-d-o.md",
    ]);
  });

  it("can match across folders and name", () => {
    const m = matchFile("guidesshort", "guides/shortcuts.md");
    expect(m).not.toBeNull();
    expect(m!.indices.slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("gives indices in the full relative path", () => {
    expect(matchFile("rd", "docs/readme.md")?.indices).toEqual([5, 8]);
  });
});
