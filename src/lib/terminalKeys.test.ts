import { describe, expect, it } from "vitest";
import { terminalKeyInput } from "./terminalKeys";

const key = (k: string, mods: { shift?: boolean; alt?: boolean; ctrl?: boolean; meta?: boolean } = {}) => ({
  key: k,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
});

describe("terminalKeyInput", () => {
  it("sends ESC CR for shift+enter, on every platform", () => {
    expect(terminalKeyInput(key("Enter", { shift: true }), true)).toBe("\x1b\r");
    expect(terminalKeyInput(key("Enter", { shift: true }), false)).toBe("\x1b\r");
  });

  it("leaves enter and its other combinations to xterm.js", () => {
    expect(terminalKeyInput(key("Enter"), true)).toBeNull();
    expect(terminalKeyInput(key("Enter", { alt: true }), true)).toBeNull();
    expect(terminalKeyInput(key("Enter", { shift: true, ctrl: true }), true)).toBeNull();
  });

  it("moves by word with option+arrows on the Mac", () => {
    expect(terminalKeyInput(key("ArrowLeft", { alt: true }), true)).toBe("\x1bb");
    expect(terminalKeyInput(key("ArrowRight", { alt: true }), true)).toBe("\x1bf");
    expect(terminalKeyInput(key("ArrowLeft", { alt: true }), false)).toBeNull();
  });

  it("goes to the line's ends and deletes it with command keys on the Mac", () => {
    expect(terminalKeyInput(key("ArrowLeft", { meta: true }), true)).toBe("\x01");
    expect(terminalKeyInput(key("ArrowRight", { meta: true }), true)).toBe("\x05");
    expect(terminalKeyInput(key("Backspace", { meta: true }), true)).toBe("\x15");
    expect(terminalKeyInput(key("c", { meta: true }), true)).toBeNull();
  });
});
