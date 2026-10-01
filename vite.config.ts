/// <reference types="vitest/config" />
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// Exported pages link KaTeX's stylesheet from a CDN; this pins it to the
// installed version's exact bytes (the CDN serves the npm package as is).
const katexCss = readFileSync(createRequire(import.meta.url).resolve("katex/dist/katex.min.css"));
const katexCssIntegrity = `sha384-${createHash("sha384").update(katexCss).digest("base64")}`;

export default defineConfig({
  plugins: [react()],
  define: { __KATEX_CSS_INTEGRITY__: JSON.stringify(katexCssIntegrity) },
  clearScreen: false,
  // Desktop app: assets load from disk, so bundle size matters little.
  build: { chunkSizeWarningLimit: 2000 },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // CSS is off in tests by default, which also empties `?raw` stylesheet imports.
  test: { css: true },
});
