// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { deviceProperties, firstToday, themeName } from "./analytics";

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

describe("firstToday", () => {
  it("is true once a day for each name", () => {
    const storage = memoryStorage();
    const morning = new Date(2026, 9, 4, 9);
    const evening = new Date(2026, 9, 4, 22);
    expect(firstToday("active", storage, morning)).toBe(true);
    expect(firstToday("active", storage, evening)).toBe(false);
    expect(firstToday("terminal", storage, evening)).toBe(true);
    expect(firstToday("active", storage, new Date(2026, 9, 5, 0, 5))).toBe(true);
  });

  it("records nothing when storage fails", () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error("quota");
    };
    expect(firstToday("active", storage)).toBe(false);
  });
});

describe("themeName", () => {
  it("names built-in themes and hides people's own", () => {
    expect(themeName("mido-dark")).toBe("mido-dark");
    expect(themeName("my-theme-1712345")).toBe("custom");
  });
});

describe("deviceProperties", () => {
  it("names the system and the kind of device as PostHog does", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    expect(deviceProperties(mac)).toMatchObject({ $os: "Mac OS X", $device_type: "Desktop" });
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
    expect(deviceProperties(iphone)).toMatchObject({ $os: "iOS", $device_type: "Mobile" });
    const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0";
    expect(deviceProperties(windows)).toMatchObject({ $os: "Windows", $device_type: "Desktop" });
  });
});
