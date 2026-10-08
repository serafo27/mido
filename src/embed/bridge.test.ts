// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { dispatch, on } from "./bridge";

describe("embed bridge events", () => {
  it("keeps events that arrive before a listener, and hands them to the first one", async () => {
    dispatch("terminal:new", { id: "a" });
    dispatch("terminal:new", { id: "b" });
    const listener = vi.fn();
    on("terminal:new", listener);
    // Delivered after the caller has finished setting up.
    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(listener.mock.calls.map(([e]) => e.payload)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("delivers straight away once someone listens", () => {
    const listener = vi.fn();
    const off = on("fs-changed", listener);
    dispatch("fs-changed", ["/x.md"]);
    expect(listener).toHaveBeenCalledWith({ event: "fs-changed", payload: ["/x.md"] });
    off();
  });
});
