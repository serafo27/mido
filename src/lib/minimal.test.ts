import { describe, expect, it } from "vitest";
import { hiddenByMinimal } from "./minimal";

const key = (code: string, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}, k = "") => ({
  key: k,
  code,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

describe("hiddenByMinimal", () => {
  it("stops the shortcuts that show what Minimal Mode hides", () => {
    for (const e of [
      key("Backquote", { ctrl: true }),
      key("Backquote", { ctrl: true, shift: true }),
      key("KeyG", { ctrl: true, shift: true }),
      key("KeyK", { meta: true }),
      key("KeyK", { meta: true, shift: true }),
      key("KeyM", { meta: true, alt: true }),
      key("KeyO", { meta: true, shift: true }),
      key("KeyM", { meta: true, shift: true }),
      key("KeyF", { meta: true, shift: true }),
    ]) {
      expect(hiddenByMinimal(e, true), JSON.stringify(e)).toBe(true);
    }
  });

  it("leaves reading and writing alone", () => {
    for (const e of [
      key("KeyS", { meta: true }, "s"),
      key("Digit1", { meta: true }, "1"),
      key("Digit3", { meta: true }, "3"),
      key("Equal", { meta: true }, "="),
      key("KeyZ", { alt: true }),
      key("KeyP", { meta: true }, "p"),
      key("Tab", { ctrl: true }),
      key("KeyB", { meta: true }, "b"),
      key("KeyM", { meta: true }, "m"),
      key("Backslash", { meta: true }, "\\"),
      key("KeyK", {}, "k"),
    ]) {
      expect(hiddenByMinimal(e, true), JSON.stringify(e)).toBe(false);
    }
  });

  it("reads Ctrl as the modifier off macOS", () => {
    expect(hiddenByMinimal(key("KeyK", { ctrl: true }), false)).toBe(true);
    expect(hiddenByMinimal(key("KeyK", { meta: true }), false)).toBe(false);
  });
});
