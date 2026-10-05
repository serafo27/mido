import { describe, expect, it } from "vitest";
import { publishSelection, watchSelection, type MirroredSelection } from "./selectionMirror";

function watch() {
  const seen: (MirroredSelection | null)[] = [];
  const stop = watchSelection((s) => seen.push(s));
  return { seen, stop };
}

describe("selection mirror", () => {
  it("tells the other side what's selected, and when it's gone", () => {
    const { seen, stop } = watch();
    publishSelection("a.md", "editor", { from: 2, to: 9 });
    publishSelection("a.md", "editor", null);
    stop();
    expect(seen).toEqual([null, { path: "a.md", side: "editor", from: 2, to: 9 }, null]);
  });

  it("keeps the other side's selection when this side has none", () => {
    publishSelection("a.md", "preview", { from: 4, to: 6 });
    const { seen, stop } = watch();
    publishSelection("a.md", "editor", null);
    publishSelection("b.md", "preview", null);
    stop();
    expect(seen).toEqual([{ path: "a.md", side: "preview", from: 4, to: 6 }]);
    publishSelection("a.md", "preview", null);
  });

  it("treats an empty range as nothing selected, and skips repeats", () => {
    const { seen, stop } = watch();
    publishSelection("a.md", "editor", { from: 3, to: 5 });
    publishSelection("a.md", "editor", { from: 3, to: 5 });
    publishSelection("a.md", "editor", { from: 5, to: 5 });
    stop();
    expect(seen).toEqual([null, { path: "a.md", side: "editor", from: 3, to: 5 }, null]);
  });
});
