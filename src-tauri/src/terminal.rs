//! Terminals in the app, as in VS Code: the user's login shell in a
//! pseudo-terminal, started in the window's open folder. Output streams to
//! the webview through a channel per terminal, as raw bytes (xterm.js
//! decodes them, even when a character is split between two reads).
//!
//! A terminal can move to another window (a floating one, and back): its
//! window detaches it, which holds its output back, and hands it over; the
//! new window attaches its own channels and gets what was held back.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Manager, Runtime, State, WebviewWindow};

/// The most output held back while a terminal is between windows; past it, the oldest goes.
const MAX_HELD: usize = 1 << 20;

type DataChannel = Channel<InvokeResponseBody>;
type ExitChannel = Channel<Option<u32>>;

/// Where a terminal's output goes: its window's channels, or nowhere yet while
/// it's between windows, when it's held back.
#[derive(Default)]
struct Output {
    channels: Option<(DataChannel, ExitChannel)>,
    held: Vec<u8>,
    /// Bytes sent since the channels were attached, so a window can wait until it got them all.
    sent: u64,
}

impl Output {
    fn data(&mut self, bytes: &[u8]) {
        if let Some((data, _)) = &self.channels {
            if data.send(InvokeResponseBody::Raw(bytes.to_vec())).is_ok() {
                self.sent += bytes.len() as u64;
                return;
            }
            // The webview went away without detaching: hold on, in case another attaches.
            self.channels = None;
        }
        self.held.extend_from_slice(bytes);
        if self.held.len() > MAX_HELD {
            let excess = self.held.len() - MAX_HELD;
            self.held.drain(..excess);
        }
    }

    fn attach(&mut self, data: DataChannel, exit: ExitChannel) -> Result<(), String> {
        if self.channels.is_some() {
            return Err("That terminal is already attached".to_string());
        }
        self.sent = 0;
        let held = std::mem::take(&mut self.held);
        if !held.is_empty() {
            data.send(InvokeResponseBody::Raw(held.clone())).map_err(crate::err)?;
            self.sent = held.len() as u64;
        }
        self.channels = Some((data, exit));
        Ok(())
    }

    /// Holds the output back from now on; returns how much was sent before.
    fn detach(&mut self) -> u64 {
        self.channels = None;
        self.sent
    }
}

/// A running terminal.
struct Terminal {
    /// The window it belongs to: it ends when the window closes.
    window: String,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    output: Arc<Mutex<Output>>,
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

    /// Gives a detached terminal of window `from` to window `to`, which can then attach it.
    pub fn hand_over(&self, id: u32, from: &str, to: &str) -> Result<(), String> {
        with_terminal(self, id, from, |t| {
            if t.output.lock().map_err(crate::err)?.channels.is_some() {
                return Err("Detach the terminal before handing it over".to_string());
            }
            t.window = to.to_string();
            Ok(())
        })
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
    on_data: DataChannel,
    on_exit: ExitChannel,
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
    let output = Arc::new(Mutex::new(Output { channels: Some((on_data, on_exit)), ..Output::default() }));
    terminals.running.lock().map_err(crate::err)?.insert(
        id,
        Terminal { window: window.label().to_string(), master: pair.master, writer, child, output: output.clone() },
    );

    let running = terminals.running.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => match output.lock() {
                    Ok(mut output) => output.data(&buffer[..n]),
                    Err(_) => break,
                },
            }
        }
        // The shell is done: reap it. (Between windows, nobody hears of it: attaching then fails.)
        let terminal = running.lock().ok().and_then(|mut r| r.remove(&id));
        let code = terminal.and_then(|mut t| t.child.wait().ok()).map(|status| status.exit_code());
        if let Some((_, exit)) = output.lock().ok().and_then(|o| o.channels.clone()) {
            let _ = exit.send(code);
        }
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

/// Holds a terminal's output back, to move it to another window. Returns how
/// many bytes were sent: the window waits for them, then saves its screen.
#[tauri::command]
pub async fn pty_detach<R: Runtime>(
    window: WebviewWindow<R>,
    terminals: State<'_, Terminals>,
    id: u32,
) -> Result<u64, String> {
    with_terminal(&terminals, id, window.label(), |t| Ok(t.output.lock().map_err(crate::err)?.detach()))
}

/// Sends a detached terminal's output to the calling window again (the one it
/// was handed to, or its own), starting with what was held back.
#[tauri::command]
pub async fn pty_attach<R: Runtime>(
    window: WebviewWindow<R>,
    terminals: State<'_, Terminals>,
    id: u32,
    on_data: DataChannel,
    on_exit: ExitChannel,
) -> Result<(), String> {
    with_terminal(&terminals, id, window.label(), |t| t.output.lock().map_err(crate::err)?.attach(on_data, on_exit))
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

    /// A data channel that keeps what it gets.
    fn recorder() -> (DataChannel, Arc<Mutex<Vec<u8>>>) {
        let got = Arc::new(Mutex::new(Vec::new()));
        let sink = got.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Raw(bytes) = body {
                sink.lock().unwrap().extend(bytes);
            }
            Ok(())
        });
        (channel, got)
    }

    #[test]
    fn holds_output_back_between_windows() {
        let (first, first_got) = recorder();
        let mut output = Output::default();
        output.attach(first, Channel::new(|_| Ok(()))).unwrap();
        output.data(b"one ");
        assert_eq!(output.detach(), 4);
        output.data(b"two ");
        output.data(b"three");
        assert_eq!(*first_got.lock().unwrap(), b"one ");

        let (second, second_got) = recorder();
        output.attach(second, Channel::new(|_| Ok(()))).unwrap();
        assert_eq!(*second_got.lock().unwrap(), b"two three");
        output.data(b"!");
        assert_eq!(*second_got.lock().unwrap(), b"two three!");
        assert_eq!(output.detach(), 10);
    }

    #[test]
    fn attaches_once() {
        let mut output = Output::default();
        output.attach(Channel::new(|_| Ok(())), Channel::new(|_| Ok(()))).unwrap();
        assert!(output.attach(Channel::new(|_| Ok(())), Channel::new(|_| Ok(()))).is_err());
    }

    #[test]
    fn holds_back_only_the_latest_output() {
        let mut output = Output::default();
        output.data(&vec![b'a'; MAX_HELD]);
        output.data(b"end");
        assert_eq!(output.held.len(), MAX_HELD);
        assert!(output.held.ends_with(b"aend"));
    }

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
