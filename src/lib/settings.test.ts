import { describe, expect, it } from "vitest";
import { blocksImage, DEFAULT_SETTINGS, migrateDefaults } from "./settings";

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
