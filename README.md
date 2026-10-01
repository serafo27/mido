<p align="center">
  <img src="assets/icon.svg" width="96" height="96" alt="Mido icon" />
</p>

<h1 align="center">Mido</h1>

<p align="center">
  <strong>A quiet place to read and write Markdown.</strong><br />
  A Markdown viewer and editor for macOS, built with Tauri, Rust and React.
</p>

<p align="center">
  <a href="https://serafo27.github.io/mido/">Website</a> ·
  <a href="https://github.com/serafo27/mido/releases/latest">Download</a> ·
  <a href="https://serafo27.github.io/mido/changelog.html">Changelog</a> ·
  <a href="#features">Features</a> ·
  <a href="#development">Development</a> ·
  <a href="#license">License</a>
</p>

![Mido in split mode: Markdown source on the left, rendered page on the right](site/assets/screens/hero.webp)

## Download

Get the latest installer from the [releases page](https://github.com/serafo27/mido/releases/latest) or the [website](https://serafo27.github.io/mido/#download):

| Platform | Package |
| --- | --- |
| macOS | `.dmg` for Apple Silicon and Intel |

Windows and Linux builds are planned but not published yet.

Mido isn't code-signed yet: the first time, right-click the app and choose **Open** (or run `xattr -cr /Applications/Mido.app`).

## Features

- **Folder sidebar** — a tree of the Markdown files in any folder, with a name filter, create / rename / move to trash from the context menu, and live refresh when files change on disk.
- **Open from anywhere** — double-click a Markdown file in the Finder, use **Open With → Mido**, or drop it on the Dock icon: Mido opens its folder and the file in a tab. From the terminal, `open -a Mido notes.md` (or a folder); add `alias mido="open -a Mido"` to your shell profile to type `mido notes.md`.
- **Quick search** (`⌘P`) — a Spotlight-style panel that finds files by name (fuzzy: `rdm` finds `README.md`) and every line containing the text you type. Choose with the arrow keys and press Return to open the file at that line.
- **Search in files** (`⌘⇧F`) — search the text of every Markdown file in the folder, with match-case and whole-word options. Results are grouped by file; click one to jump to its line.
- **Three modes** — Read (`⌘1`), Split with synced scrolling and a resizable divider (`⌘2`), and Edit (`⌘3`).
- **Rendering** — GitHub Flavored Markdown (tables, task lists, footnotes, strikethrough), GitHub-style alerts, KaTeX math, Mermaid diagrams (` ```mermaid ` blocks, following light and dark themes), syntax highlighting, frontmatter shown as a card, sanitized HTML, relative images, and relative `.md` links that open inside Mido.
- **Wrap or scroll** (`⌥Z`) — wrap everything to the window, or keep code blocks and tables intact and scroll sideways. Applies to the editor too.
- **Tabs** — a single click opens a file in a *preview* tab (italic) that the next single click replaces; double-click a file or tab to keep it open, and editing a file keeps it open automatically. Drag to reorder, middle-click or `⌘W` to close, `⌘⇧[` / `⌘⇧]` or `Ctrl+Tab` to switch. Each tab keeps its own undo history, selection and scroll position, and open tabs are restored on launch.
- **Outline** (`⌘⇧O`) — a panel listing the document's headings. Click to jump to a section; the current section is highlighted as you scroll.
- **Editor** — CodeMirror 6 with Markdown and code-block highlighting, `⌘B` / `⌘I` / `⌘K` for bold, italic and links, and `⌘F` to search. Paste an image (`⌘V`, e.g. a screenshot) or drop image files into the editor: they're saved in an `assets` folder next to the document and linked where you paste or drop them.
- **Reading styles** — Mido, GitHub, Academic and Minimal presets, plus separate fonts for body, headings and code (bundled, system, or any installed font), text size, line height, page width, justified text and frontmatter visibility.
- **Themes** — Auto / Light / Dark mode with a preferred theme for each. Built in: Mido Light & Dark, VS Code Light+ & Dark+, IntelliJ Light & Darcula, Relax, Relax Night, Solarized Light, Nord and Dracula. Accent colour follows the theme or can be overridden.
- **Custom themes** — duplicate any theme, edit its nineteen colours with live preview, and share it as JSON (see below).
- **Export and print** — **File → Export as HTML…** (`⌘⇧E`) saves a standalone page with the current theme and reading style, images embedded and diagrams included. **File → Print…** (`⌥⌘P`) prints the document on its own in the light theme; choose **Save as PDF** in the print panel for a PDF.
- **Saving** — autosave while you type (can be turned off) or `⌘S`. Mido asks before closing with unsaved changes.
- **File path bar** — shows `folder › … › file` above the tabs; turn it off in settings to move the tabs into the title bar.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘O` | Open folder |
| `⌘1` `⌘2` `⌘3` | Read · Split · Edit |
| `⌘S` | Save |
| `⌘⇧E` | Export as HTML |
| `⌥⌘P` | Print (or save as PDF) |
| `⌘W` | Close tab |
| `⌘⇧[` `⌘⇧]` / `Ctrl+Tab` | Previous · next tab |
| `⌘P` | Quick search: files and text |
| `⌘⇧F` | Search in files |
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
pnpm tauri build    # production bundle (.app / .dmg)
```

Open the `examples/` folder in Mido to try every rendering feature.

### Continuous integration

- **Build** (`.github/workflows/build.yml`) builds the app for macOS (Apple Silicon and Intel) on every push to `main` and on pull requests; the installers are attached to each run as artifacts. Windows and Linux jobs are ready to be re-enabled in the build matrix once tested. To release a version: add its section to [CHANGELOG.md](CHANGELOG.md), set the same version in `src-tauri/tauri.conf.json` and `package.json`, then push a matching tag (for example `git tag v0.2.0 && git push --tags`). The workflow checks that the tag matches the app version, builds the installers, uses the changelog section as the release notes and publishes the release once every build has succeeded. The website's changelog page lists every published release.
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

## License

Copyright © 2026 Serafino D'Angelillo. All rights reserved.

Mido is **source-available, not open source**. You're welcome to read the code and to download and use the official installers for free, for personal or commercial purposes. Copying, modifying or redistributing the code or builds — including publishing it in other repositories or websites — requires prior written permission. See [LICENSE](LICENSE) for the full terms.
