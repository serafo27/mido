# Changelog

All notable changes to Mido are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Mido follows
[Semantic Versioning](https://semver.org/).

When a version is released, its section below becomes the release notes on
GitHub and on the website's changelog page.

## [Unreleased]

### Added

- Comments: select text in the editor or the preview and press `⌥⌘M` to start a thread on it. A Comments panel (`⌘⇧M`) beside the outline lists the threads in document order, with replies, resolving and reopening; commented text is highlighted, and clicking it shows its thread. Comments are signed with your git user and saved in a hidden `.mido` folder inside the open folder, one file per comment, so they can be committed and pushed with the documents and never cause merge conflicts. Resolving a thread gathers its comments into a single file. Threads follow their text as the document changes, move with renamed files, and those whose text was removed are listed apart. Mido for the web shows comments but doesn't write them.

### Changed

- Mido for the web shows Mido's icon and name in the top-left corner, linking back to the website.

## [0.6.0] - 2026-10-01

### Added

- Mido for the web, at <https://serafo27.github.io/mido/app/>: open folders and Markdown files from your computer and read them in the browser, with the app's rendering, themes, tabs, outline, search, export and printing. It's read-only: editing, creating, renaming and deleting point to the desktop app. Nothing is uploaded. Chromium browsers reopen recent folders and pick up changes made on disk; Safari and Firefox read a folder as it is when opened.

### Fixed

- The empty screen listed `⌘P` as "Filter files"; it opens quick search since 0.5.0.
- Error messages no longer start with "Error:".

## [0.5.0] - 2026-10-01

### Added

- Paste images (`⌘V`, e.g. a screenshot) or drop image files into the editor: Mido saves them in an `assets` folder next to the document, never replacing an existing file, and inserts the link where you paste or drop.
- Quick search (`⌘P`): a Spotlight-style panel that finds files by name, fuzzily, and every line containing the text you type, across the open folder. Choose with the arrow keys and press Return to open the file at that line.

### Changed

- `⌘P` now opens quick search instead of focusing the sidebar's file filter, which is still there.

## [0.4.0] - 2026-10-01

### Added

- Search in files (`⌘⇧F`): search the text of every Markdown file in the open folder, with match-case and whole-word options, and jump to a result's line with a click.
- Mermaid diagrams: ` ```mermaid ` code blocks render as diagrams that follow the light or dark theme, with the error shown in place of a diagram that doesn't parse.
- Export as HTML (`⌘⇧E`): a standalone page with the current theme and reading style, local images embedded and diagrams included.
- Print (`⌥⌘P`), which also saves PDFs from the print panel: the document prints on its own, in the light theme, with page breaks kept out of code blocks, tables, images and diagrams.

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

[Unreleased]: https://github.com/serafo27/mido/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/serafo27/mido/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/serafo27/mido/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/serafo27/mido/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/serafo27/mido/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/serafo27/mido/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/serafo27/mido/releases/tag/v0.1.0
