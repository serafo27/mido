// Mido embedded in another app, a host (see docs/embed.md). Same app,
// with Tauri swapped for stand-ins that forward every call to the host window
// (src/embed). The build ships inside Mido.app (Contents/Resources/embed), so
// hosts load whichever Mido is installed, updates included.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import base from "./vite.config";
import { EMBED_PROTOCOL } from "./src/embed/protocol";

const here = dirname(fileURLToPath(import.meta.url));
const embed = (path: string) => join(here, "src/embed/tauri", path);
const { version } = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

/** `embed.json`: what a host reads to know it can load this build. */
function manifest(): Plugin {
  return {
    name: "mido-embed-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "embed.json",
        source: JSON.stringify(
          // `views`: what a host can show — the app on a folder, or only terminals (index.html?view=terminal).
          { name: "mido", version, protocol: EMBED_PROTOCOL, entry: "index.html", views: ["docs", "terminal"] },
          null,
          2,
        ),
      });
    },
  };
}

export default mergeConfig(
  base,
  defineConfig({
    base: "./",
    define: {
      "import.meta.env.VITE_EMBED": JSON.stringify("1"),
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
    },
    resolve: {
      alias: [
        { find: /^@tauri-apps\/api\/core$/, replacement: embed("core.ts") },
        { find: /^@tauri-apps\/api\/event$/, replacement: embed("event.ts") },
        { find: /^@tauri-apps\/api\/window$/, replacement: embed("window.ts") },
        { find: /^@tauri-apps\/api\/webviewWindow$/, replacement: embed("webviewWindow.ts") },
        { find: /^@tauri-apps\/api\/app$/, replacement: embed("app.ts") },
        { find: /^@tauri-apps\/plugin-dialog$/, replacement: embed("dialog.ts") },
        { find: /^@tauri-apps\/plugin-opener$/, replacement: embed("opener.ts") },
        { find: /^@tauri-apps\/plugin-process$/, replacement: embed("process.ts") },
        { find: /^@tauri-apps\/plugin-updater$/, replacement: embed("updater.ts") },
      ],
    },
    plugins: [manifest()],
    build: { outDir: "dist-embed", emptyOutDir: true },
  }),
);
