import { describe, expect, it } from "vitest";
import { blocksImage } from "./settings";

describe("blocksImage", () => {
  it("loads everything with all, only https with secure, nothing remote with none", () => {
    const srcs = ["http://x/a.png", "//x/a.png", "https://x/a.png", "a.png", "data:image/png;base64,AA"];
    expect(srcs.map((s) => blocksImage("all", s))).toEqual([false, false, false, false, false]);
    expect(srcs.map((s) => blocksImage("secure", s))).toEqual([true, true, false, false, false]);
    expect(srcs.map((s) => blocksImage("none", s))).toEqual([true, true, true, false, false]);
  });
});
