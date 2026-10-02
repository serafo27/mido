import { describe, expect, it } from "vitest";
import { ANSI_KEYS, ansiVariable, BUILTIN_THEMES, findTheme, terminalColors, themeVariables } from "./themes";

describe("terminalColors", () => {
  it("gives every built-in theme all sixteen colours", () => {
    for (const theme of BUILTIN_THEMES) {
      const colors = terminalColors(theme);
      for (const key of ANSI_KEYS) expect(colors[key], `${theme.id} ${key}`).toBeTruthy();
    }
  });

  it("keeps a well-known theme's own palette", () => {
    expect(terminalColors(findTheme("dracula", [], "dark")).red).toBe("#ff5555");
  });

  it("draws a theme's colours from its code colours otherwise", () => {
    const mido = findTheme("mido-dark", [], "dark");
    const colors = terminalColors(mido);
    expect(colors.green).toBe(mido.palette.string);
    expect(colors.blue).toBe(mido.palette.function);
    expect(colors.brightBlack).toBe(mido.palette.faint);
  });

  it("follows a custom theme's colours, even when copied from a well-known one", () => {
    const nord = findTheme("nord", [], "dark");
    const copy = { ...nord, id: "custom-1", custom: true, palette: { ...nord.palette, string: "#00ff00" } };
    expect(terminalColors(copy).green).toBe("#00ff00");
  });
});

describe("themeVariables", () => {
  it("sets the terminal's colours as --ansi-* variables", () => {
    const vars = themeVariables(findTheme("nord", [], "dark"));
    expect(vars[ansiVariable("brightBlack")]).toBe("#616e88");
    expect(ansiVariable("brightBlack")).toBe("--ansi-bright-black");
  });
});
