// The read-only web version of Mido, published on the website at /mido/app/.
// Same app, with Tauri swapped for stand-ins that read the folders and files
// visitors open in the browser (src/web).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import base from "./vite.config";

// Plain strings rather than URL objects: the config is also loaded by the tests' DOM environment.
const here = dirname(fileURLToPath(import.meta.url));
const web = (path: string) => join(here, "src/web/tauri", path);
const { version } = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

/**
 * A Content Security Policy for the page (the desktop app gets its own from
 * Tauri): only the app's scripts run, including the inline theme script,
 * allowed by its hash.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: "mido-web-csp",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
          ([, code]) => `'sha256-${createHash("sha256").update(code).digest("base64")}'`,
        );
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(" ")}`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' blob: data: https: http:",
          "font-src 'self' data:",
          "connect-src 'self' blob: data:",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
          "frame-src 'none'",
        ].join("; ");
        return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      },
    },
  };
}

/** The site's icon as the page's favicon. */
function favicon(): Plugin {
  return {
    name: "mido-web-favicon",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "icon.svg", source: readFileSync(join(here, "site/assets/icon.svg")) });
    },
    transformIndexHtml: (html) =>
      html.replace("</title>", '</title>\n    <link rel="icon" type="image/svg+xml" href="./icon.svg" />'),
  };
}

/** What search engines and link previews show for the page. */
function searchMetadata(): Plugin {
  const title = "Mido for the web — read Markdown in your browser";
  const description =
    "Open folders and Markdown files from your computer and read them in the browser with Mido. Nothing is uploaded: your files never leave your computer.";
  const url = "https://serafo27.github.io/mido/app/";
  const image = "https://serafo27.github.io/mido/assets/og-image.jpg";
  return {
    name: "mido-web-search-metadata",
    transformIndexHtml: (html) =>
      html.replace(
        "<title>Mido</title>",
        [
          `<title>${title}</title>`,
          `<meta name="description" content="${description}" />`,
          `<meta property="og:title" content="${title}" />`,
          `<meta property="og:description" content="${description}" />`,
          `<meta property="og:type" content="website" />`,
          `<meta property="og:site_name" content="Mido" />`,
          `<meta property="og:url" content="${url}" />`,
          `<meta property="og:image" content="${image}" />`,
          `<meta name="twitter:card" content="summary_large_image" />`,
          `<link rel="canonical" href="${url}" />`,
        ].join("\n    "),
      ),
  };
}

export default mergeConfig(
  base,
  defineConfig({
    base: "./",
    define: {
      "import.meta.env.VITE_WEB": JSON.stringify("1"),
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
    },
    resolve: {
      alias: [
        { find: /^@tauri-apps\/api\/core$/, replacement: web("core.ts") },
        { find: /^@tauri-apps\/api\/event$/, replacement: web("event.ts") },
        { find: /^@tauri-apps\/api\/window$/, replacement: web("window.ts") },
        { find: /^@tauri-apps\/api\/app$/, replacement: web("app.ts") },
        { find: /^@tauri-apps\/plugin-dialog$/, replacement: web("dialog.ts") },
        { find: /^@tauri-apps\/plugin-opener$/, replacement: web("opener.ts") },
      ],
    },
    plugins: [contentSecurityPolicy(), favicon(), searchMetadata()],
    build: { outDir: "dist-web", emptyOutDir: true },
  }),
);
