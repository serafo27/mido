import { describe, expect, it } from "vitest";
import { blocksImage, DEFAULT_SETTINGS, migrateDefaults, spaceLines, terminalFontCss, terminalFontSize, zoomTerminal, zoomText } from "./settings";

describe("blocksImage", () => {
  it("loads everything with all, only https with secure, nothing remote with none", () => {
    const srcs = ["http://x/a.png", "//x/a.png", "https://x/a.png", "a.png", "data:image/png;base64,AA"];
    expect(srcs.map((s) => blocksImage("all", s))).toEqual([false, false, false, false, false]);
    expect(srcs.map((s) => blocksImage("secure", s))).toEqual([true, true, false, false, false]);
    expect(srcs.map((s) => blocksImage("none", s))).toEqual([true, true, true, false, false]);
  });
});

describe("migrateDefaults", () => {
  const storage = (items: Record<string, string>) => {
    const map = new Map(Object.entries(items));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      map,
    } as unknown as Storage & { map: Map<string, string> };
  };
  const settingsIn = (s: { map: Map<string, string> }) => JSON.parse(s.map.get("mido.settings") ?? "{}");

  it("gives new installs the new defaults", () => {
    const s = storage({});
    migrateDefaults(s);
    expect(settingsIn(s)).toEqual({});
    expect({ ...DEFAULT_SETTINGS, ...settingsIn(s) }.theme).toBe("dark");
  });

  it("keeps the old defaults, and what was chosen, for earlier installs", () => {
    const s = storage({ "mido.themeCache": "{}", "mido.settings": JSON.stringify({ fontSize: 18 }) });
    migrateDefaults(s);
    expect(settingsIn(s)).toMatchObject({ theme: "system", style: "mido", tabStyle: "classic", fontSize: 18 });
  });

  it("runs once", () => {
    const s = storage({ "mido.themeCache": "{}" });
    migrateDefaults(s);
    s.map.set("mido.settings", JSON.stringify({ theme: "dark" }));
    migrateDefaults(s);
    expect(settingsIn(s).theme).toBe("dark");
  });
});

describe("zoomText", () => {
  it("makes both text sizes bigger or smaller together", () => {
    const settings = { ...DEFAULT_SETTINGS, fontSize: 16, editorFontSize: 14 };
    expect(zoomText(settings, 1)).toEqual({ fontSize: 17, editorFontSize: 15 });
    expect(zoomText(settings, -1)).toEqual({ fontSize: 15, editorFontSize: 13 });
  });

  it("stays within the sizes Settings offers", () => {
    expect(zoomText({ ...DEFAULT_SETTINGS, fontSize: 24, editorFontSize: 21.5 }, 1)).toEqual({ fontSize: 24, editorFontSize: 22 });
    expect(zoomText({ ...DEFAULT_SETTINGS, fontSize: 13, editorFontSize: 11 }, -1)).toEqual({ fontSize: 13, editorFontSize: 11 });
  });

  it("goes back to the defaults with 0", () => {
    expect(zoomText({ ...DEFAULT_SETTINGS, fontSize: 20, editorFontSize: 19 }, 0)).toEqual({
      fontSize: DEFAULT_SETTINGS.fontSize,
      editorFontSize: DEFAULT_SETTINGS.editorFontSize,
    });
  });
});

describe("spaceLines", () => {
  it("opens up or tightens both line heights by a tenth, within their ranges", () => {
    const settings = { ...DEFAULT_SETTINGS, lineHeight: 1.58, editorLineHeight: 1.75 };
    expect(spaceLines(settings, 1)).toEqual({ lineHeight: 1.68, editorLineHeight: 1.85 });
    expect(spaceLines(settings, -1)).toEqual({ lineHeight: 1.48, editorLineHeight: 1.65 });
    expect(spaceLines({ ...settings, lineHeight: 2.15, editorLineHeight: 2.4 }, 1)).toEqual({
      lineHeight: 2.2,
      editorLineHeight: 2.4,
    });
  });
});

describe("terminalFontCss", () => {
  it("uses the system's monospaced font by default, as Terminal does", () => {
    expect(terminalFontCss("")).toMatch(/^ui-monospace,/);
  });

  it("puts a named font first, with the system's after it for missing characters", () => {
    expect(terminalFontCss(" MesloLGS NF ")).toMatch(/^"MesloLGS NF", ui-monospace,/);
  });
});

describe("zoomTerminal", () => {
  it("moves a terminal's size away from the editor's, and back with 0", () => {
    expect(zoomTerminal(14, 0, 1)).toBe(1);
    expect(zoomTerminal(14, 1, -3)).toBe(-2);
    expect(zoomTerminal(14, 5, 0)).toBe(0);
  });

  it("stays within range, so the way back is as long as the way there", () => {
    expect(zoomTerminal(14, 18, 1)).toBe(18);
    expect(zoomTerminal(14, -6, -1)).toBe(-6);
    // The editor's size grew past the range while the offset was set: one step back is one pixel smaller.
    expect(zoomTerminal(30, 4, -1)).toBe(1);
    expect(terminalFontSize(30, 1)).toBe(31);
  });
});
