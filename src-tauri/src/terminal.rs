//! Terminals in the app, as in VS Code: the user's login shell in a
//! pseudo-terminal, started in the window's open folder. Output streams to
//! the webview through a channel per terminal, as raw bytes (xterm.js
//! decodes them, even when a character is split between two reads).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Manager, Runtime, State, WebviewWindow};

/// A running terminal.
struct Terminal {
    /// The window it belongs to: it ends when the window closes.
    window: String,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Terminals {
    next: AtomicU32,
    running: Arc<Mutex<HashMap<u32, Terminal>>>,
}

impl Terminals {
    /// Ends the terminals of a window that closed.
    pub fn close_window(&self, label: &str) {
        if let Ok(mut running) = self.running.lock() {
            running.retain(|_, t| {
                if t.window == label {
                    let _ = t.child.kill();
                    false
                } else {
                    true
                }
            });
        }
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 }
}

/// The user's shell, as a login shell so it has their PATH (an app opened
/// from the Finder starts with a bare one).
fn shell_command(cwd: &PathBuf) -> CommandBuilder {
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| {
        if cfg!(windows) { "powershell.exe".to_string() } else { "/bin/zsh".to_string() }
    });
    let mut command = CommandBuilder::new(&shell);
    if !cfg!(windows) {
        command.arg("-l");
    }
    command.cwd(cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "Mido");
    command.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    // Apps opened from the Finder have no locale: without one, shells mangle non-ASCII text.
    if std::env::var_os("LANG").is_none() {
        command.env("LANG", "en_US.UTF-8");
    }
    command
}

/// Starts a terminal in the window's open folder (or the home folder when
/// none is open) and returns its id. Output goes to `on_data`; when the shell
/// exits, its exit code goes to `on_exit`.
#[tauri::command]
pub async fn pty_spawn<R: Runtime>(
    window: WebviewWindow<R>,
    terminals: State<'_, Terminals>,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<Option<u32>>,
) -> Result<u32, String> {
    // The folder comes from the backend, not the webview.
    let root = window.state::<crate::Workspaces>().root(window.label()).ok().flatten();
    let cwd = root
        .filter(|p| p.is_dir())
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("/"));

    let pair = native_pty_system().openpty(size(cols, rows)).map_err(crate::err)?;
    let child = pair.slave.spawn_command(shell_command(&cwd)).map_err(crate::err)?;
    // The shell holds its own end now; ours would keep the terminal open after it exits.
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(crate::err)?;
    let writer = pair.master.take_writer().map_err(crate::err)?;

    let id = terminals.next.fetch_add(1, Ordering::Relaxed) + 1;
    terminals.running.lock().map_err(crate::err)?.insert(
        id,
        Terminal { window: window.label().to_string(), master: pair.master, writer, child },
    );

    let running = terminals.running.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if on_data.send(InvokeResponseBody::Raw(buffer[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
        // The shell is done (or the webview went away): reap it.
        let terminal = running.lock().ok().and_then(|mut r| r.remove(&id));
        let code = terminal.and_then(|mut t| t.child.wait().ok()).map(|status| status.exit_code());
        let _ = on_exit.send(code);
    });
    Ok(id)
}

fn with_terminal<T>(
    terminals: &Terminals,
    id: u32,
    window: &str,
    f: impl FnOnce(&mut Terminal) -> Result<T, String>,
) -> Result<T, String> {
    let mut running = terminals.running.lock().map_err(crate::err)?;
    match running.get_mut(&id) {
        // A window can only use its own terminals.
        Some(t) if t.window == window => f(t),
        _ => Err("That terminal has ended".to_string()),
    }
}

/// Types `data` (keys, pasted text) into a terminal.
#[tauri::command]
pub async fn pty_write<R: Runtime>(
    window: WebviewWindow<R>,
    terminals: State<'_, Terminals>,
    id: u32,
    data: String,
) -> Result<(), String> {
    with_terminal(&terminals, id, window.label(), |t| {
        t.writer.write_all(data.as_bytes()).map_err(crate::err)?;
        t.writer.flush().map_err(crate::err)
    })
}

#[tauri::command]
pub async fn pty_resize<R: Runtime>(
    window: WebviewWindow<R>,
    terminals: State<'_, Terminals>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    with_terminal(&terminals, id, window.label(), |t| t.master.resize(size(cols, rows)).map_err(crate::err))
}

/// Ends a terminal's shell. Its exit still comes through `on_exit`.
#[tauri::command]
pub async fn pty_kill<R: Runtime>(
    window: WebviewWindow<R>,
    terminals: State<'_, Terminals>,
    id: u32,
) -> Result<(), String> {
    with_terminal(&terminals, id, window.label(), |t| t.child.kill().map_err(crate::err))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_the_login_shell_in_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let pair = native_pty_system().openpty(size(80, 24)).unwrap();
        let mut child = pair.slave.spawn_command(shell_command(&dir.path().to_path_buf())).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        writer.write_all(b"echo \"[$TERM_PROGRAM:$(basename $PWD)]\"; exit\n").unwrap();
        let mut output = Vec::new();
        let _ = reader.read_to_end(&mut output);
        let output = String::from_utf8_lossy(&output);
        let folder = dir.path().file_name().unwrap().to_string_lossy();
        assert!(output.contains(&format!("[Mido:{folder}]")), "{output}");
        assert!(child.wait().unwrap().success());
    }
}
