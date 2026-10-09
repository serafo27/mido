# Changelog

All notable changes to Mido are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Mido follows
[Semantic Versioning](https://semver.org/).

When a version is released, its section below becomes the release notes on
GitHub and on the website's changelog page.

## [Unreleased]

### Changed

- **Mido Pro** checks its license with Polar when Mido opens, at most twice a day, instead of once a week. Offline it still works for a month after the last check.

### Fixed

- A saved **Mido Pro** license that claims to have been checked in the future no longer counts: Mido checks it with Polar again straight away.

## [0.22.0] - 2026-10-09

### Added

- **Mido Pro: the assistant.** Chat with Claude Code about your documents in a panel beside them (`⌘⇧L`). It runs the Claude Code installed on your Mac, with your own Claude account, and reads what you choose: the documents open in tabs (unsaved changes included), the folder, or every folder open in Mido. Answers stream in as formatted Markdown, show the files it read, and link to them.
- **Ask about a passage.** Select text in the preview or the editor and click **Ask** (`⌥⌘L`): the passage goes with your question, and **Explain**, **Simplify** and **Summarize** ask in one click.
- **Notes and changes from the assistant.** It writes notes and summaries into an `ai` folder in your project (the folder can be changed in **Settings → Mido Pro**), and they open as they're written; **Save as note** keeps any answer there too. To change one of your documents it asks first, showing the change as a diff, with **Allow**, **Decline** and **Allow all in this chat**. Everything it writes shows in source control.
- **Several conversations.** Start a new chat with **+**, switch between the open ones from the panel's header, close one with **Close chat**, and find every chat about a folder in its **History**. A chat can open in a **tab**, to read it in the document's reading column, and go back to the side panel.
- **Mido Pro** is a one-time purchase, sold through Polar: buy it from the assistant's panel, paste the license key, and it's on for that Mac. **Settings → Mido Pro** shows it, links to your purchases and frees the Mac for another. Mido checks the license with Polar once a week and keeps working offline for a month.

### Changed

- A little more room between **Read · Split · Edit** and the buttons after it in the toolbar.

## [0.21.0] - 2026-10-08

### Added

- **Mido inside other apps.** Another desktop app can show Mido as its reader and editor for a folder of documents: the installed Mido.app now carries an embeddable build (`Contents/Resources/embed`), so the app loads whatever Mido you have, with its updates. The host opens the folder and answers Mido's file, search and comment requests, limited to that folder; it can also show Mido's terminals alone. Embedded, Mido takes the host's theme and leaves the terminal, git, updates and window controls to it. The protocol is in [docs/embed.md](docs/embed.md).

## [0.20.0] - 2026-10-05

### Added

- **Move files and folders** by dragging them onto another folder in the sidebar, or onto the empty space under the tree for the top folder. Mido asks before moving, and open tabs and comments follow.

### Fixed

- In the **terminal**, `⇧↩` starts a new line instead of sending the text, in Claude Code and other programs that accept it, as `⌥↩` does. On the Mac, `⌥←` `⌥→` move by word, `⌘←` `⌘→` go to the start and end of the line, and `⌘⌫` deletes back to its start, as in Terminal, iTerm2 and VS Code.

## [0.19.3] - 2026-10-05

### Added

- A **GitHub Light** theme, with GitHub's colours for the interface, the code and the terminal.
- Three new **reading styles**: **VS Code**, **Obsidian** and **Notion** lay out a document as their apps do, with any theme's colours.
- A **recent folder** can be taken off the list: hover it, in the folder menu or on the start page, and click its ×.

### Changed

- The **GitHub** reading style now follows github.com closely: its heading sizes and spacing, plain quotes and alerts, inline code, code blocks, tables with full borders, and images without rounded corners or shadows.
- The item under the pointer in **menus** and lists is a soft tint of the accent instead of the full colour, so its text stays easy to read, also on dark themes.

## [0.19.2] - 2026-10-05

### Fixed

- The **window** opens where you left it, at the size you gave it, also after an update. If that place is on a screen that's no longer connected, it opens at the default size in the middle.

## [0.19.1] - 2026-10-05

### Fixed

- Long headings no longer have to be cut off in the **outline**: drag its left edge to widen it, up to half the window. Mido remembers the width.

### Changed

- The website's changelog shows the latest three versions, with older ones a few at a time under **Show older versions**. A link to an older version still opens at it.

## [0.19.0] - 2026-10-05

### Added

- In **Split**, the text you select on one side is highlighted on the other: select a sentence in the preview to find it in the source and edit it, or select in the editor to see how it reads. Markup is matched too, so `**Tauri**` in the source is **Tauri** on the page.

### Changed

- The website also shows **Minimal Mode**, **quick search** and **export and print**, in small sections with a picture each, under the features. The "Keyboard first" card gives ⌥⌘K for a link, since ⌘K opens the commit dialog in a git repository.

## [0.18.0] - 2026-10-05

### Added

- **Minimal Mode**, to read and write with nothing else on screen: **View → Minimal Mode** (⌃⌘M) in the menu bar. The window keeps only the document, the folder's tree in the sidebar, the open file's path and Read · Split · Edit. The tabs, the sidebar's buttons and filter, the toolbar's other buttons, the status bar, the format bar, the minimap, comments, search, source control and the terminal hide; the terminal's shells keep running. In Edit, the editor writes on the same column the preview reads on. Shortcuts that would show what's hidden do nothing; saving, the view modes, text size, ⌘P and switching files still work. Each window has its own, and it's remembered across launches.
## [0.17.0] - 2026-10-05

### Added

- **Floating terminals**: the new button in the terminal panel's header moves the selected terminal into a window of its own, to place anywhere on the desktop. Its shell keeps running, and its screen and scrollback come along. Closing the window, ⌘W or its **Move Back to Panel** button puts the terminal back in the panel. Closing the app window closes its floating terminals too.
- **Each terminal's own text size**: with the cursor in a terminal, ⌘+ and ⌘− make only that terminal's text bigger or smaller, and ⌘0 brings it back to the editor's size. It keeps its size when it moves to a window and back.

### Changed

- The **commit dialog** (⌘K) and the **push dialog** (⌘⇧K) open in windows of their own, to move anywhere on the desktop, beside the document. They reopen where they were left. Double-clicking a file opens its diff in the app window.

### Fixed

- No more white flash when Mido opens or while a window is resized: windows take the theme's background from the start.
## [0.16.0] - 2026-10-04

### Added

- **Anonymous usage statistics**, to learn how many people use Mido and which features matter: at most once a day, the app and the web version send that Mido was used, its version, platform and processor, the theme, and whether git and the terminal were used, under a random id that identifies nobody. Never files, their names, paths or contents; IP addresses aren't stored. They go to PostHog on EU servers. Turn them off in the new **Settings → Privacy**.

## [0.15.0] - 2026-10-02

### Changed

- The **terminal** is no longer experimental: it's always there, with the **Terminal** menu, ⌃` to show or hide it and ⌃⇧` for a new one. Its font is in the new **Settings → Terminal**.
- The terminal takes its colours from the theme: Nord, Dracula, Solarized, VS Code and IntelliJ keep their own terminal palettes, and the other themes, custom ones included, draw theirs from their code colours. It's drawn on the GPU, as in VS Code, for crisper, evenly spaced text; Powerline arrows and box lines join up, and colours too faint for the background are made readable.
- The terminal uses the system's monospaced font, as Terminal does, at the editor's text size, or any installed font (a Nerd Font for a prompt's symbols). It waits for that font before measuring, so text sits on its grid; emoji and East Asian characters take their two cells, so the cursor no longer drifts after them; and its margins are even.
- Each terminal's tab has a **×** that ends its shell and closes it, as in VS Code (a middle click does too). The × at the panel's right still only hides the panel, and the shells keep running.
- Once every terminal is closed, the next one is **Terminal 1** again.

## [0.14.0] - 2026-10-02

### Changed

- The **formatting toolbar** also appears in **Split** mode, over the editor side. As that side narrows, its buttons move into the **⋯** menu instead of running over the preview.
- The website is dark by default, with a light/dark switch in its header. Its title types itself and its sections drift in as you scroll.

## [0.13.0] - 2026-10-02

### Added

- **Commit button with a menu**, as in VS Code: **Commit**, **Commit (Amend)**, **Commit & Push** and **Commit & Sync**. With nothing to commit it becomes what the branch needs: **Sync Changes** (pull, then push) or **Publish Branch**.
- The **commit dialog** (⌘K) is laid out as IntelliJ's: the files to commit on top, grouped into Changes and Unversioned Files with each folder's file count, the message under them, and git's options beside them: **Author**, **Amend commit** (starting from the last commit's message) and **Sign-off commit**. The diff runs along the bottom, collapsible and resizable, with the previous and next file.
- **Changes** and **Graph** in the source control panel fold to their titles; when both are folded they slide up to the top.

### Changed

- **Source control is no longer experimental**: it's on in every git repository again, with no setting to turn it on. Only the terminal is still experimental.
- Source control is calmer and closer to VS Code's: file names in the text colour with an icon for their kind, only the status letter coloured, a thin guide line along each group's files, and grey counts. The graph shows each commit's message rather than its author, on a thin muted line.
- Diffs use softer reds and greens, easier on the eyes in a long review, and a new or deleted file is no longer highlighted word by word.
- In the panel only the changed files scroll, under their group's title: the branch, the message and the Commit button stay put. The message's placeholder fits on one line.
- The commit and push dialogs have macOS window buttons on the left, in place of the × on the right, with small square checkboxes.
- The website shows source control, the writing toolbar and Word export, with new screenshots.

### Fixed

- A changed file with a long name no longer hides its Stage button and status letter on hover.

## [0.12.0] - 2026-10-02

### Added

- **Formatting toolbar** in Edit mode, like a word processor's: paragraph style (headings), bold, italic, strikethrough, code, links, images, bulleted, numbered and task lists, quotes, code blocks, tables (pick the size from a grid), rules, and under **⋯** formulas, Mermaid diagrams and footnotes. Buttons light up for the formatting at the cursor. **Settings → Editor** hides it.
- Selecting text in the editor shows formatting buttons over it; selecting in the preview still offers **Comment**.
- **File → Export as Word…** (⌥⌘E): a .docx with Word's own headings, numbered lists, footnotes and equations, coloured code and diagrams as pictures. Comments become Word comments on the same text, with their replies, and resolved threads are marked done. In the web version, the export button offers HTML or Word.
- **⌘+** and **⌘−** make text bigger or smaller (the document and the editor together), **⌘0** resets it. **⌘⇧+** and **⌘⇧−** open up or tighten the line spacing. The editor's line height is now a setting of its own.
- **Experimental features**, off by default and turned on at the bottom of Settings:
  - **Terminal**, as in VS Code: your shell in the open folder, under the document, in tabs, with a **Terminal** menu (New Terminal ⌃⇧\`, Toggle Terminal ⌃\`, Clear, Kill) and a button in the status bar.
  - **Source control (git)**:
    - **Source control** for folders in a git repository (the folder itself or one above it), in the sidebar (⌃⇧G): laid out like VS Code's: a commit message and **Commit**, **Pull** and **Push** with the number of commits waiting, staged changes and changes with their status colours, staging file by file, and a graph of the branch's history with each commit's files. **Fetch**, **Pull** (asking whether to merge or rebase each time) and **Push** (offering to publish a new branch) are also in the panel's title. Nothing happens on its own: Mido only does what you click.
    - Changed files show their git letter (M, A, D, U) in the file tree, and the branch shows in the status bar.
    - Diffs open in tabs next to your files, as in VS Code: a file's changes, its staged changes, or what a commit changed in it, side by side or inline, with line numbers, the words that changed highlighted, unchanged stretches folded, and buttons to jump between changes and to stage or unstage. A single click opens a preview tab; a double click keeps it.
    - Merge and rebase conflicts open in a tab as VS Code shows them: the current and incoming changes coloured, with **Accept Current Change**, **Accept Incoming Change** and **Accept Both Changes** above each, the text editable, and **Mark as Resolved** to stage the file. Then **Commit Merge** (or **Continue Rebase**) finishes, and **Abort** goes back.
    - **Commit dialog** (⌘K, or the list icon in the panel's title), as in IntelliJ: every change with a checkbox to stage it, in a folder tree you can fold (each folder's checkbox stages what's in it) or as a list, the selected file's diff beside it, the commit message, and **Commit** or **Commit and Push…**. In a git repository ⌘K opens it everywhere, and ⌥⌘K inserts a link in the editor.
    - **Push dialog** (⌘⇧K): where the branch goes, the commits about to leave and each one's files, then **Push** (or **Publish and Push** for a new branch).
    - Both dialogs move by their title bar and resize from any edge or corner, like windows, and open where you left them; double-click the title bar to center them again.
    - **Branches**: click the branch in the panel or the status bar to switch to one (a remote branch gets a local one tracking it), create one from a name, merge one into the current branch, or delete a merged one.
    - **Discard Changes** on a file, or on all the changes, after asking: files go back to their staged or committed contents, and new files go to the Trash.
    - The history graph stays in view below the changes, which scroll on their own; drag the line between them to resize.
    - Source control is about your documents: it lists only Markdown files (and Mido's comments) and the commits that touch them. A line says how many other files changed, and warns when one of them is staged and would be committed. **Settings → Source Control → Show all files** lists everything.
    - Git runs as it does in Terminal, with your keys, credentials, hooks and settings, and only in a repository you've allowed it in.

## [0.11.0] - 2026-10-02

### Added

- **Mido → New Window** (⇧⌘N) opens another window, each with its own folder and tabs. Settings and recent folders are shared, and a change made in one window applies to all. The main window still reopens its folder at launch; the others start empty.
- Updates install from inside Mido: **Install** downloads the new version and puts it in place, then **Restart Mido** opens it, after saving your edits in every window. No more `.dmg` to download, and no more macOS warning after each update. This version still has to be installed by hand, one last time.

### Changed

- New installs start with a different look: the GitHub reading style with system fonts (14.5px text, line height 1.58, 1000px page), dark mode with the amber accent, rounded tabs and no file path bar. If you already use Mido, your settings stay as they are.
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

[Unreleased]: https://github.com/serafo27/mido/compare/v0.16.0...HEAD
[0.16.0]: https://github.com/serafo27/mido/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/serafo27/mido/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/serafo27/mido/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/serafo27/mido/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/serafo27/mido/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/serafo27/mido/compare/v0.10.0...v0.11.0
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
