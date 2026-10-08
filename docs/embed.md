# Mido embedded in another app

Mido can run inside another desktop app (a *host*), for instance one that uses
it as the reader and editor for a project's documentation. The host loads the
Mido that is installed on the machine, so whatever version the user has, with
its updates, is what they get in the host too.

## The build

`pnpm build:embed` builds `dist-embed/` with `vite.embed.config.ts`: the same app,
with `@tauri-apps/*` aliased to the stand-ins in `src/embed/tauri/`. Every Tauri
call becomes a message to the host window (`src/embed/bridge.ts`).

`pnpm tauri build` runs it too and ships the folder inside the app:

```
Mido.app/Contents/Resources/embed/
  embed.json      { "name": "mido", "version": "0.21.0", "protocol": 1, "entry": "index.html", "views": ["docs", "terminal"] }
  index.html
  assets/…
```

A host finds Mido at `/Applications/Mido.app` (or `~/Applications/Mido.app`),
reads `embed.json`, and loads it only if it speaks that `protocol`.

`isEmbed` (`src/lib/platform.ts`) is true in this build. It turns off what the
host owns: the terminal (`hasTerminal`), source control (`hasGit`), updates
(`hasUpdates`), window chrome, the folder switcher, the themes (`host:theme`)
and analytics.

## Views

- **docs** (`index.html`): the whole app on a folder the host opens.
- **terminal** (`index.html?view=terminal`, `src/embed/EmbedTerminals.tsx`): only
  terminals, drawn by Mido's `TerminalView` with Mido's theme, fonts and keys,
  for a host's terminal panel. The host decides which terminals exist (one page
  per project, say) and runs their shells.

A host checks `views` in `embed.json` before using one; builds without the field only have `docs`.

## Loading

The host serves the folder from a custom scheme and shows `index.html` in an
iframe, for instance `mido://localhost/`. Images in documents are requested as
`<origin>/__file__/<absolute path>` (`convertFileSrc`), and the host must only
serve files inside the open folder.

## Messages

All messages are `postMessage` objects with `mido: <protocol>`. Mido only
accepts messages from `window.parent`; the host must only accept messages
from its iframe.

From Mido to the host:

| `type` | Fields | Meaning |
| --- | --- | --- |
| `ready` | `payload: { version }` | The page loaded. Send `open-requests` if a folder is waiting. |
| `invoke` | `id`, `command`, `args`, `headers?` | A Tauri command. Answer with `result`. `args` is a `Uint8Array` for raw-body commands (`save_asset`, `export_word`), with the metadata in `headers`. |
| `title` | `payload: string` | The window title Mido would set. |
| `terminal` | `payload: "new" \| "toggle"` | ⌃⇧` / ⌃`: open a terminal, or show or hide the host's terminals. |
| `terminal:output` | `payload: { id }` | Terminal view: a terminal printed something (at most once a second). |
| `terminal:bell` | `payload: { id }` | Terminal view: a program rang the bell, e.g. Claude Code waiting for input. |
| `terminal:exit` | `payload: { id, code }` | Terminal view: a shell ended. On code 0 or none, Mido has closed the terminal. |
| `close-result` | `payload: boolean` | Answer to `host:close-request`: `false` if the user kept unsaved edits open. |

From the host to Mido:

| `type` | Fields | Meaning |
| --- | --- | --- |
| `result` | `id`, `ok`, `value` or `error` | The answer to an `invoke`. |
| `event` | `event`, `payload` | A Tauri event: see below. |
| `channel` | `id`, `message` | A message on a channel Mido passed to a command (see Channels). |

Events the host sends:

- `open-requests`: there are folders or files to open. Mido then calls
  `take_open_requests`. To show a project, the host queues
  `{ path: <project folder>, isDir: true }`; to open a document, `{ path, isDir: false }`.
- `fs-changed` (`string[]` of paths) and `comments-changed`: from a file watcher
  on the open folder, as Mido's own backend sends them (hidden paths excluded,
  `.mido/comments` reported as `comments-changed`).
- `host:close-request`: before the host switches folder or closes. Mido runs
  its close handlers (saving, or asking about unsaved edits) and replies with
  `close-result`.
- `host:theme` (`{ name, kind, palette, ansi? }`): the theme to show. `palette`
  has Mido's 19 theme colours (`Palette` in `src/lib/themes.ts`), `ansi` the 16
  terminal colours (derived from the palette when missing). Embedded, it's the
  only theme: Settings hide Mido's modes, themes and accents. Send it on
  `ready` and whenever the host's theme changes; until then Mido shows its own.
- Terminal view: `terminal:new` (`{ id, command?, env? }`: open a terminal with
  the host's id, its shell running `command` first), `terminal:select` (`id`),
  `terminal:kill` (`id`), `terminal:clear` (`id`).

## Channels

A Tauri `Channel` passed in a command's arguments travels as
`{ __midoChannel: <id> }`. The host makes a real channel in its place and relays
each message back as `{ type: "channel", id, message }` (an `ArrayBuffer`, for
terminal output, can be transferred).

## Commands

The host answers these with the same arguments, results and checks as Mido's
backend (`src-tauri/src/lib.rs`), limited to the folder it opened:

- Folder: `open_folder` (only folders the host allows), `read_tree`, `take_open_requests`, `pick_folder` (returns `null`)
- Files: `read_file`, `write_file` (with the `expected` conflict check), `create_file`, `create_dir`, `rename_path`, `trash_path`, `search_files`
- Comments: `read_comments`, `add_comment_file`, `compact_comment_thread`, `git_identity`
- Assets and exports: `save_asset`, `export_html`, `export_word`
- Platform: `app_arch`; `set_window_background`, `set_minimal_mode`, `open_new_window` can do nothing
- Host services (the shims' own): `dialog_ask`, `dialog_message`, `open_url`, `reveal_item`

- Terminal view: `pty_spawn` (`cols`, `rows`, `command?`, `env?`, `onData`, `onExit` channels; the host picks the folder), `pty_write`, `pty_resize`, `pty_kill`

`git_*` and `pty_detach` / `pty_attach` (floating terminals) are never called in this build.

## Changing the protocol

Bump `EMBED_PROTOCOL` (`src/embed/protocol.ts`) when a message or command
changes in a way an existing host would get wrong. Hosts refuse builds with a
protocol they don't know and fall back to their own editor, so an older host
never runs a newer Mido it can't serve.
