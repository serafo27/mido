// @vitest-environment happy-dom
// The web version swaps Tauri for the modules in src/web/tauri. This keeps the
// two in step: every Rust command the app calls needs a web counterpart, and
// every Tauri export the app imports needs a stand-in.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commands } from "./backend";
import webConfig from "../../vite.web.config";

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "web" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

const appSources = sources("src").map((path) => readFileSync(path, "utf8"));

describe("web stand-ins", () => {
  it("handle every command the app invokes", () => {
    const invoked = new Set(appSources.flatMap((src) => [...src.matchAll(/invoke(?:<[^>]*>)?\("([a-z_]+)"/g)].map((m) => m[1])));
    expect(invoked.size).toBeGreaterThan(5);
    for (const command of invoked) expect(commands, `web command for ${command}`).toHaveProperty(command);
  });

  it("export everything the app imports from Tauri", async () => {
    const aliases = (webConfig as { resolve: { alias: { find: RegExp; replacement: string }[] } }).resolve.alias;
    for (const src of appSources) {
      for (const [, names, module] of src.matchAll(/import \{([^}]+)\} from "(@tauri-apps\/[^"]+)"/g)) {
        const alias = aliases.find((a) => a.find.test(module));
        expect(alias, `alias for ${module}`).toBeDefined();
        const shim = await import(/* @vite-ignore */ alias!.replacement);
        for (const spec of names.split(",").map((n) => n.trim())) {
          // Skip type-only imports; `open as openDialog` needs `open`.
          if (!spec || spec.startsWith("type ")) continue;
          const name = spec.split(/\s+as\s+/)[0];
          expect(shim, `${module} → ${name}`).toHaveProperty(name);
        }
      }
    }
  });
});
