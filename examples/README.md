---
title: Welcome to Mido
tags: [markdown, demo, tauri]
author: Mido
---

# Welcome to Mido

Mido is a **quiet place** to read and write *Markdown*. Open a folder, pick a file
from the sidebar and switch between **Read**, **Split** and **Edit** with `⌘1`, `⌘2`, `⌘3`.

> Simplicity is prerequisite for reliability.
> — Edsger W. Dijkstra

## Text & links

Inline `code`, ~~strikethrough~~, <kbd>⌘</kbd> + <kbd>S</kbd>, a footnote[^1], an
[external link](https://tauri.app) and a [relative link](guides/shortcuts.md) that opens in Mido.

> [!NOTE]
> GitHub-style alerts are supported.

> [!WARNING]
> Changes are autosaved by default — toggle it in the status bar.

## Lists

- [x] Folder navigation in the sidebar
- [x] Split view with scroll sync
- [ ] World domination
  1. Nested ordered
  2. Lists work too

## Code

```rust
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string()) // a deliberately long trailing comment to show what happens with wrapping enabled and disabled in the preview
}
```

```ts
const greet = (name: string): string => `Hello, ${name}!`;
```

## Table

| Mode  | Shortcut | Description                                                                 |
| ----- | :------: | --------------------------------------------------------------------------- |
| Read  |   `⌘1`   | Only the rendered document                                                  |
| Split |   `⌘2`   | Editor on the left, live preview on the right, scroll kept in sync as you type |
| Edit  |   `⌘3`   | Distraction-free editor                                                     |

## Math

Euler's identity $e^{i\pi} + 1 = 0$, and a display equation:

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

<details>
<summary>Raw HTML works (sanitized)</summary>

Hidden content revealed.

</details>

---

[^1]: Footnotes render at the bottom of the document.
