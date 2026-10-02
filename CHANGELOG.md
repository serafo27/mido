# Changelog

All notable changes to Mido are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Mido follows
[Semantic Versioning](https://semver.org/).

When a version is released, its section below becomes the release notes on
GitHub and on the website's changelog page.

## [Unreleased]

### Added

- **Mido → New Window** (⇧⌘N) opens another window, each with its own folder and tabs. Settings and recent folders are shared, and a change made in one window applies to all. The main window still reopens its folder at launch; the others start empty.

### Changed

- The open folder, at the top of the sidebar, now reads as one: its name with a folder icon and a switch arrow. Clicking it lists the recent folders to switch to, **Open Folder…** and **New Window**.

## [0.10.0] - 2026-10-01

### Added

- In split view, scrolling the preview scrolls the editor too, as in VS Code. Both sides stay on the same line, inside long lists, tables and code blocks as well.
- Switching between Read, Split and Edit keeps your place in the document.
- Code is highlighted with the grammars VS Code uses, for many more languages (Rust, Zig, Dockerfile and others), in your theme's colours.
- Mermaid diagrams take your theme's colours.
- **Settings → Layout → Images from the web** chooses which images from the internet a document may load: all, only secure (HTTPS) ones, or none. A blocked image shows as a button that loads it.
- TOML frontmatter is shown, and YAML frontmatter with nested values, lists of entries or text on several lines shows correctly.

### Changed

- Images from the web over plain HTTP are no longer loaded unless you allow them (see above): loading one tells its server you opened the document, in a way anyone on the network can see.
- While you type, the preview only renders again what changed: long documents stay responsive (about ten times faster).
- The outline lists headings inside quotes and lists too, as the preview shows them.

### Fixed

- An image whose path contains a bare `%` no longer leaves the window blank. A document that can't be rendered shows the error in the page.
- A link to a section of another document (`notes.md#setup`) opens that document at the section, and a link to a section of the document you're reading scrolls to it.
- Links to old-style `<a name="…">` anchors work.
- Scroll sync no longer skips HTML blocks such as `<div align="center">`, and the editor and the preview are no longer about two lines apart.
- The editor's minimap no longer changes as you scroll through the document.

### Security

- Ids and names set by HTML in a document can no longer shadow the app's own objects.

## [0.9.1] - 2026-10-01

### Security

- Mido only opens folders you chose: in the Open Folder dialog, from the Finder, the Dock or the command line. Any other folder, including a recent folder opened before this version, asks for your confirmation once, so a malicious document can never reach the rest of the disk.
- A symlink in the open folder that leads outside it can still be opened and read, but Mido no longer saves, creates or deletes files through it.
- Pages exported as HTML only use KaTeX's stylesheet from the CDN if it is exactly the expected file.

## [0.9.0] - 2026-10-01

### Added

- When the tabs don't all fit, arrows either side of them scroll the tab bar left and right.

### Fixed

- Preview tabs no longer show a scrollbar, and with rounded tabs their outward curve no longer appears beside the close button. Their name can no longer be selected as text.

## [0.8.0] - 2026-10-01

### Added

- Rounded tabs, shaped like folder tabs, in **Settings → Appearance → Tabs**. Classic square tabs stay the default.

## [0.7.1] - 2026-10-01

### Fixed

- Scrolling with the mouse wheel or the trackpad over the minimap scrolls the document.

## [0.7.0] - 2026-10-01

### Added

- Comments: select text in the editor or the preview and click **Comment** over the selection, or press `⌥⌘M`, to start a thread on it. A Comments panel (`⌘⇧M`) beside the outline lists the threads in document order, with replies, resolving and reopening. Commented text has a light dotted underline; hovering it shows the first comment and its replies, clicking it opens the thread, and ticks beside the scrollbar show where the threads are. Comments are signed with your git user and saved in a hidden `.mido` folder inside the open folder, one file per comment, so they can be committed and pushed with the documents and never cause merge conflicts. Resolving a thread gathers its comments into a single file. Threads follow their text as the document changes, move with renamed files, and those whose text was removed are listed apart. Mido for the web shows comments but doesn't write them.
- A minimap in place of the scrollbar, like VS Code's, turned on in **Settings → Reading**: the editor shows the text in small, the preview a miniature of the rendered page. Click to jump, drag the frame to scroll; comments are marked on it.

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

[Unreleased]: https://github.com/serafo27/mido/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/serafo27/mido/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/serafo27/mido/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/serafo27/mido/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/serafo27/mido/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/serafo27/mido/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/serafo27/mido/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/serafo27/mido/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/serafo27/mido/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/serafo27/mido/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/serafo27/mido/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/serafo27/mido/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/serafo27/mido/releases/tag/v0.1.0
