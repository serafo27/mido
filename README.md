<p align="center">
  <img src="assets/icon.svg" width="96" height="96" alt="Mido icon" />
</p>

<h1 align="center">Mido</h1>

<p align="center">
  <strong>A quiet place to read and write Markdown.</strong><br />
  A desktop Markdown viewer and editor for macOS, Windows and Linux, built with Tauri, Rust and React.
</p>

<p align="center">
  <a href="https://serafo27.github.io/mido/">Website</a> ·
  <a href="https://github.com/serafo27/mido/releases/latest">Download</a> ·
  <a href="#features">Features</a> ·
  <a href="#development">Development</a>
</p>

![Mido in split mode: Markdown source on the left, rendered page on the right](site/assets/screens/hero.webp)

## Download

Get the latest installer from the [releases page](https://github.com/serafo27/mido/releases/latest) or the [website](https://serafo27.github.io/mido/#download):

| Platform | Package |
| --- | --- |
| macOS | `.dmg` for Apple Silicon and Intel |
| Windows | `.exe` installer or `.msi` package |
| Linux | `.AppImage`, `.deb` or `.rpm` |

Mido isn't code-signed yet. On macOS, right-click the app and choose **Open** the first time (or run `xattr -cr /Applications/Mido.app`). On Windows, choose **More info → Run anyway** if SmartScreen appears.

## Features

- **Folder sidebar** — a tree of the Markdown files in any folder, with a filter (`⌘P`), create / rename / move to trash from the context menu, and live refresh when files change on disk.
- **Three modes** — Read (`⌘1`), Split with synced scrolling and a resizable divider (`⌘2`), and Edit (`⌘3`).
- **Rendering** — GitHub Flavored Markdown (tables, task lists, footnotes, strikethrough), GitHub-style alerts, KaTeX math, syntax highlighting, frontmatter shown as a card, sanitized HTML, relative images, and relative `.md` links that open inside Mido.
- **Wrap or scroll** (`⌥Z`) — wrap everything to the window, or keep code blocks and tables intact and scroll sideways. Applies to the editor too.
- **Tabs** — a single click opens a file in a *preview* tab (italic) that the next single click replaces; double-click a file or tab to keep it open, and editing a file keeps it open automatically. Drag to reorder, middle-click or `⌘W` to close, `⌘⇧[` / `⌘⇧]` or `Ctrl+Tab` to switch. Each tab keeps its own undo history, selection and scroll position, and open tabs are restored on launch.
- **Outline** (`⌘⇧O`) — a panel listing the document's headings. Click to jump to a section; the current section is highlighted as you scroll.
- **Editor** — CodeMirror 6 with Markdown and code-block highlighting, `⌘B` / `⌘I` / `⌘K` for bold, italic and links, and `⌘F` to search.
- **Reading styles** — Mido, GitHub, Academic and Minimal presets, plus separate fonts for body, headings and code (bundled, system, or any installed font), text size, line height, page width, justified text and frontmatter visibility.
- **Themes** — Auto / Light / Dark mode with a preferred theme for each. Built in: Mido Light & Dark, VS Code Light+ & Dark+, IntelliJ Light & Darcula, Relax, Relax Night, Solarized Light, Nord and Dracula. Accent colour follows the theme or can be overridden.
- **Custom themes** — duplicate any theme, edit its nineteen colours with live preview, and share it as JSON (see below).
- **Saving** — autosave while you type (can be turned off) or `⌘S`. Mido asks before closing with unsaved changes.
- **File path bar** — shows `folder › … › file` above the tabs; turn it off in settings to move the tabs into the title bar.

## Keyboard shortcuts

On Windows and Linux use `Ctrl` instead of `⌘` and `Alt` instead of `⌥`.

| Shortcut | Action |
| --- | --- |
| `⌘O` | Open folder |
| `⌘1` `⌘2` `⌘3` | Read · Split · Edit |
| `⌘S` | Save |
| `⌘W` | Close tab |
| `⌘⇧[` `⌘⇧]` / `Ctrl+Tab` | Previous · next tab |
| `⌘P` | Filter files |
| `⌘⇧O` | Toggle outline |
| `⌘\` | Toggle sidebar |
| `⌘,` | Settings |
| `⌥Z` | Toggle line wrap |
| `⌘B` `⌘I` `⌘K` | Bold · Italic · Link |
| `⌘F` | Find in editor |

## Theme format

Custom themes can be imported and exported as JSON from **Settings → Themes**:

```json
{
  "name": "My theme",
  "kind": "dark",
  "colors": {
    "bg": "#1b1d22", "sidebar": "#22252b", "elevated": "#2a2d34", "border": "#353942",
    "text": "#d9dce3", "muted": "#9aa0ab", "faint": "#636977", "heading": "#f2f4f8",
    "accent": "#ff8a65", "warm": "#f0b36b", "codeBg": "#22252b", "codeFg": "#f29db4",
    "keyword": "#c792ea", "string": "#c3e88d", "number": "#f78c6c", "comment": "#676e7b",
    "function": "#82aaff", "type": "#89ddff", "attr": "#ffcb6b"
  }
}
```

Every colour is optional: missing ones come from Mido Light or Mido Dark, depending on `kind`. Any CSS colour format is accepted.

## Development

Requirements:

- Rust 1.90 or later (`rustup update stable`)
- Node.js 22.12 or later (`nvm use` reads `.nvmrc`) and pnpm
- On Linux, the [Tauri system dependencies](https://tauri.app/start/prerequisites/)

```sh
pnpm install
pnpm tauri dev      # run the app with hot reload
pnpm tauri build    # production bundles (.app / .dmg / .msi / .exe / .deb …)
```

Open the `examples/` folder in Mido to try every rendering feature.

### Continuous integration

- **Build** (`.github/workflows/build.yml`) builds the app for macOS (Apple Silicon and Intel), Windows and Linux on every push to `main` and on pull requests; the installers are attached to each run as artifacts. Pushing a `v*` tag (for example `git tag v0.2.0 && git push --tags`) also creates a draft GitHub release with the installers.
- **Website** (`.github/workflows/pages.yml`) publishes the `site/` folder to GitHub Pages whenever it changes.

### Project structure

```
src-tauri/src/lib.rs    Rust commands: file tree, read/write, file operations, folder watcher, macOS menu
src/App.tsx             app state, tabs, shortcuts, layout, scroll sync
src/components/         Sidebar, Toolbar, TabBar, Editor, Preview, Outline, SettingsPanel, ThemeSection, StatusBar, Welcome
src/lib/settings.ts     settings model, font catalogue, reading-style presets
src/lib/themes.ts       built-in themes, CSS variable derivation, JSON import/export
src/lib/outline.ts      heading extraction for the outline
src/lib/markdown.ts     remark/rehype plugins, sanitization schema, frontmatter
src/styles/             app.css (interface and theme tokens), markdown.css (rendering)
site/                   the GitHub Pages website
```
