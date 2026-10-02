import { describe, expect, it } from "vitest";
import { changeTree, itemsIn, type ChangeNode } from "./changeTree";

const shape = (nodes: ChangeNode<string>[]): unknown[] =>
  nodes.map((n) => (n.kind === "file" ? n.name : { [n.name]: shape(n.children) }));

describe("changeTree", () => {
  it("nests files in their folders, folders first", () => {
    const tree = changeTree(["b.md", "docs/z.md", "docs/a.md", "a.md", "notes/x.md"], (p) => p);
    expect(shape(tree)).toEqual([{ docs: ["a.md", "z.md"] }, { notes: ["x.md"] }, "a.md", "b.md"]);
  });

  it("joins a chain of single folders into one row", () => {
    const tree = changeTree([".mido/comments/pricing/t1/a.json", ".mido/comments/pricing/t1/b.json", "docs/x.md"], (p) => p);
    expect(shape(tree)).toEqual([{ ".mido/comments/pricing/t1": ["a.json", "b.json"] }, { docs: ["x.md"] }]);
    const folder = tree[0];
    expect(folder.kind === "folder" && folder.path).toBe(".mido/comments/pricing/t1");
  });

  it("keeps a folder that holds files beside its subfolder", () => {
    const tree = changeTree(["docs/a.md", "docs/deep/b.md"], (p) => p);
    expect(shape(tree)).toEqual([{ docs: [{ deep: ["b.md"] }, "a.md"] }]);
  });

  it("lists every item under a folder", () => {
    const tree = changeTree(["docs/a.md", "docs/deep/b.md", "c.md"], (p) => p);
    expect(itemsIn(tree[0]).sort()).toEqual(["docs/a.md", "docs/deep/b.md"]);
  });
});
