# Changelog

All notable changes to Mido are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Mido follows
[Semantic Versioning](https://semver.org/).

When a version is released, its section below becomes the release notes on
GitHub and on the website's changelog page.

## [Unreleased]

### Added

- Search in files (`⌘⇧F`): search the text of every Markdown file in the open folder, with match-case and whole-word options, and jump to a result's line with a click.

## [0.3.0] - 2026-10-01

### Added

- Open Markdown files from the Finder (double-click or Open With), by dropping them on the Dock icon, or from the terminal with `open -a Mido notes.md`. Mido opens the file's folder and the file in a tab; a folder opens as the workspace.

### Fixed

- Saving no longer silently overwrites changes made to the file by another app (a `git pull`, another editor, a sync service): Mido asks whether to keep your version or discard your changes.
- Files are saved atomically, so a crash or a full disk can't leave a file empty or half-written.
- Opening a large folder no longer freezes the window while Mido reads it.
- A tab or window no longer closes when its file couldn't be saved.
- Escaped characters (like `\*`) and underscores inside words (like `snake_case`) now show correctly in the outline.

### Security

- Mido now reads and writes only files inside the open folder, and the preview only loads local images from inside it.
- A Content Security Policy keeps scripts in a Markdown file from running, even if one got past the HTML sanitizer.

## [0.2.0] - 2026-09-30

### Added

- Update checks: Mido looks for a new version at launch and every 12 hours, and shows what's new with a download button for your Mac's installer. Notifications can be turned off from the dialog or in Settings → Updates.
- "Check for Updates…" in the Mido menu, and a "Check Now" button in Settings, to check manually at any time.

## [0.1.0] - 2026-09-30

The first release of Mido, for macOS (Apple Silicon and Intel).

### Reading and writing

- Open any folder and browse its Markdown files in a sidebar, with a filter and live refresh when files change on disk.
- Create, rename and move files to the trash from the sidebar's context menu.
- Three modes: Read, Split with synced scrolling and a resizable divider, and Edit.
- Rendering of GitHub Flavored Markdown, GitHub-style alerts, KaTeX math, syntax-highlighted code, frontmatter cards, sanitized HTML, relative images and links.
- Wrap long lines to the window, or keep code blocks and tables intact and scroll sideways.
- CodeMirror 6 editor with Markdown and code highlighting, bold / italic / link shortcuts and search.
- Autosave, or manual saving with a prompt before closing with unsaved changes.

### Navigation

- Tabs with preview tabs (single click) and pinned tabs (double click), drag-and-drop reordering and per-tab undo history, selection and scroll position.
- Outline panel listing the document's headings, highlighting the section being read.
- File path bar above the tabs, which can be turned off to move the tabs into the title bar.

### Personalization

- Reading styles: Mido, GitHub, Academic and Minimal.
- Fonts for body, headings and code, including any font installed on your Mac, plus text size, line height, page width and justified text.
- Eleven themes: Mido Light and Dark, VS Code Light+ and Dark+, IntelliJ Light and Darcula, Relax, Relax Night, Solarized Light, Nord and Dracula.
- Custom themes with a colour editor and JSON import and export.
- Auto, light and dark modes, with an optional accent colour.

[Unreleased]: https://github.com/serafo27/mido/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/serafo27/mido/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/serafo27/mido/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/serafo27/mido/releases/tag/v0.1.0
