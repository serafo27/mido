# Changelog

All notable changes to Mido are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Mido follows
[Semantic Versioning](https://semver.org/).

When a version is released, its section below becomes the release notes on
GitHub and on the website's changelog page.

## [Unreleased]

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

[Unreleased]: https://github.com/serafo27/mido/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/serafo27/mido/releases/tag/v0.1.0
