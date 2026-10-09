//! The assistant: a chat about the open folder's documents with the AI
//! installed on the computer (Claude Code), in a panel next to the document.
//!
//! Mido doesn't talk to a model itself: it runs the `claude` command line the
//! user installed and signed in to, in the window's open folder, and passes
//! messages to it as JSON lines on its input. Its output, JSON lines as well
//! (`--output-format stream-json`), goes to the webview as is: the panel reads
//! the text, the files it reads and the session to resume (src/lib/ai.ts).
//!
//! It only gets the tools that read files (Read, Grep, Glob), confined to the
//! folder, without the user's settings or MCP servers (`--restricted`).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;
use tauri::ipc::Channel;
use tauri::{Manager, Runtime, State, WebviewWindow};

/// What the assistant may use: reading and searching the folder's files.
const TOOLS: &[&str] = &["Read", "Grep", "Glob"];
/// The most of its error output kept, to tell why it stopped.
const MAX_STDERR: usize = 8 * 1024;
/// How long finding `claude` through the user's shell may take.
const SHELL_TIMEOUT: Duration = Duration::from_secs(8);

const SYSTEM_PROMPT: &str = "You are the assistant in Mido, a Markdown reader and editor. \
The user is reading the documents in the current working directory and chats with you in a panel next to them. \
Answer questions about these documents: read them as needed, explain them, and point to the files and sections \
you used, with paths relative to the folder. Reply in Markdown, concisely, in the language the user writes in.";

/// A line from the assistant: one of its JSON events, or Mido's own `{"type":"mido_exit"}` when it stops.
type EventChannel = Channel<String>;

/// The assistant running for a window: one process, kept for the whole conversation.
struct Session {
    root: PathBuf,
    /// The conversation it resumed or started (its first event says which).
    id: Arc<Mutex<Option<String>>>,
    child: Child,
    stdin: ChildStdin,
    /// Where its events go: the channel of the latest message.
    events: Arc<Mutex<EventChannel>>,
}

#[derive(Default)]
pub struct Assistants {
    running: Mutex<HashMap<String, Session>>,
    /// Where `claude` is, once found.
    program: Mutex<Option<PathBuf>>,
}

impl Assistants {
    /// Ends the assistant of a window that closed.
    pub fn close_window(&self, label: &str) {
        if let Some(mut session) = self.running.lock().ok().and_then(|mut r| r.remove(label)) {
            let _ = session.child.kill();
        }
    }

    fn program(&self) -> Option<PathBuf> {
        let mut program = self.program.lock().ok()?;
        if program.as_ref().is_none_or(|p| !p.is_file()) {
            *program = find_claude();
        }
        program.clone()
    }
}

/// Where `claude` is installed: in the usual places, or wherever the user's
/// shell finds it (an app opened from the Finder doesn't have their PATH).
fn find_claude() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let usual = [
        home.as_ref().map(|h| h.join(".local/bin/claude")),
        home.as_ref().map(|h| h.join(".claude/local/claude")),
        Some(PathBuf::from("/opt/homebrew/bin/claude")),
        Some(PathBuf::from("/usr/local/bin/claude")),
    ];
    usual.into_iter().flatten().find(|p| p.is_file()).or_else(claude_from_shell)
}

/// Asks the user's interactive login shell, which reads all their startup
/// files, where `claude` is. Gives up after a few seconds, in case a startup
/// file waits for something.
fn claude_from_shell() -> Option<PathBuf> {
    const MARKER: &str = "__mido_claude__";
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".to_string());
    let mut child = Command::new(shell)
        .args(["-ilc", &format!("printf '{MARKER}%s' \"$(command -v claude)\"")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        let _ = send.send(out);
    });
    let out = receive.recv_timeout(SHELL_TIMEOUT);
    let _ = child.kill();
    let _ = child.wait();
    let path = out.ok()?.rsplit_once(MARKER)?.1.trim().to_string();
    Some(PathBuf::from(path)).filter(|p| p.is_absolute() && p.is_file())
}

/// Session ids are UUIDs: anything else isn't passed on.
fn valid_session(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// The command line for the assistant in `root`, resuming `session` if given.
fn command(program: &Path, root: &Path, session: Option<&str>) -> Command {
    let mut command = Command::new(program);
    command.args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]);
    command.args(["--include-partial-messages", "--restricted", "--strict-mcp-config", "--tools"]);
    command.args(TOOLS);
    command.args(["--append-system-prompt", SYSTEM_PROMPT]);
    if let Some(session) = session {
        command.args(["--resume", session]);
    }
    command.current_dir(root);
    // Whatever it runs is found next to it first.
    if let Some(dir) = program.parent() {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let paths = std::iter::once(dir.to_path_buf()).chain(std::env::split_paths(&path));
        if let Ok(joined) = std::env::join_paths(paths) {
            command.env("PATH", joined);
        }
    }
    // Apps opened from the Finder have no locale.
    if std::env::var_os("LANG").is_none() {
        command.env("LANG", "en_US.UTF-8");
    }
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    command
}

/// Starts the assistant in `root`, sending its events to `events`.
fn start(
    program: &Path,
    root: &Path,
    session: Option<&str>,
    events: EventChannel,
) -> Result<Session, String> {
    let mut child = command(program, root, session).spawn().map_err(crate::err)?;
    let stdin = child.stdin.take().ok_or("The assistant has no input")?;
    let stdout = child.stdout.take().ok_or("The assistant has no output")?;
    let mut stderr = child.stderr.take().ok_or("The assistant has no error output")?;
    let events = Arc::new(Mutex::new(events));
    let id = Arc::new(Mutex::new(session.map(str::to_string)));

    let errors = Arc::new(Mutex::new(Vec::new()));
    let kept = errors.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        while let Ok(n) = stderr.read(&mut buffer) {
            if n == 0 {
                break;
            }
            if let Ok(mut kept) = kept.lock() {
                kept.extend_from_slice(&buffer[..n]);
                let excess = kept.len().saturating_sub(MAX_STDERR);
                kept.drain(..excess);
            }
        }
    });

    let channel = events.clone();
    let started = id.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                if event["type"] == "system" && event["subtype"] == "init" {
                    if let (Some(session), Ok(mut id)) = (event["session_id"].as_str(), started.lock()) {
                        *id = Some(session.to_string());
                    }
                }
            }
            if let Ok(channel) = channel.lock() {
                let _ = channel.send(line);
            }
        }
        // Its output ended: it stopped (or was stopped). Its error output tells why.
        std::thread::sleep(Duration::from_millis(50));
        let stderr = errors.lock().map(|e| String::from_utf8_lossy(&e).trim().to_string()).unwrap_or_default();
        if let Ok(channel) = channel.lock() {
            let _ = channel.send(json!({ "type": "mido_exit", "stderr": stderr }).to_string());
        }
    });

    Ok(Session { root: root.to_path_buf(), id, child, stdin, events })
}

/// Where `claude` is installed, or null when it isn't (the panel then explains how to install it).
#[tauri::command]
pub async fn ai_detect(assistants: State<'_, Assistants>) -> Result<Option<String>, String> {
    Ok(assistants.program().map(|p| p.to_string_lossy().into_owned()))
}

/// Sends a message to the window's assistant, starting it in the window's
/// folder if it isn't running (resuming `session`, the conversation the panel
/// shows, if given). Its events, from now on, go to `on_event`.
#[tauri::command]
pub async fn ai_send<R: Runtime>(
    window: WebviewWindow<R>,
    assistants: State<'_, Assistants>,
    message: String,
    session: Option<String>,
    on_event: EventChannel,
) -> Result<(), String> {
    // The folder comes from the backend, not the webview.
    let root = window
        .state::<crate::Workspaces>()
        .root(window.label())?
        .filter(|p| p.is_dir())
        .ok_or("Open a folder to chat about it")?;
    let session = session.filter(|s| valid_session(s));
    let label = window.label().to_string();

    let mut running = assistants.running.lock().map_err(crate::err)?;
    // The one running is for another folder or conversation, or has stopped: start again.
    if let Some(current) = running.get_mut(&label) {
        let same_session = current.id.lock().map(|id| *id == session).unwrap_or(false);
        let alive = matches!(current.child.try_wait(), Ok(None));
        if current.root != root || !same_session || !alive {
            let _ = current.child.kill();
            let _ = current.child.wait();
            running.remove(&label);
        }
    }
    if !running.contains_key(&label) {
        let program = assistants.program().ok_or("Claude Code isn't installed")?;
        let started = start(&program, &root, session.as_deref(), on_event.clone())?;
        running.insert(label.clone(), started);
    }
    let current = running.get_mut(&label).ok_or("The assistant has stopped")?;
    *current.events.lock().map_err(crate::err)? = on_event;
    let line = json!({ "type": "user", "message": { "role": "user", "content": message } });
    writeln!(current.stdin, "{line}").map_err(crate::err)?;
    current.stdin.flush().map_err(crate::err)
}

/// Stops the window's assistant, in the middle of an answer too. The next
/// message starts it again, resuming the conversation.
#[tauri::command]
pub async fn ai_stop<R: Runtime>(window: WebviewWindow<R>, assistants: State<'_, Assistants>) -> Result<(), String> {
    assistants.close_window(window.label());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_only_session_ids_on() {
        assert!(valid_session("7858e9da-4f5d-49be-b27d-ca8a412678c0"));
        assert!(!valid_session(""));
        assert!(!valid_session("--dangerously-skip-permissions"));
        assert!(!valid_session("abc def"));
    }

    #[test]
    fn runs_with_the_reading_tools_only_in_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let command = command(Path::new("/opt/claude/bin/claude"), dir.path(), Some("abc-123"));
        let args: Vec<_> = command.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.contains(&"--restricted".to_string()));
        let tools = args.iter().position(|a| a == "--tools").unwrap();
        assert_eq!(&args[tools + 1..tools + 4], TOOLS);
        assert!(args.windows(2).any(|w| w == ["--resume", "abc-123"]));
        assert_eq!(command.get_current_dir(), Some(dir.path()));
        let path = command.get_envs().find(|(k, _)| *k == "PATH").and_then(|(_, v)| v).unwrap();
        assert!(path.to_string_lossy().starts_with("/opt/claude/bin"));
    }

    /// Runs the real `claude`: it needs it installed and signed in, and spends a little of the user's plan.
    /// `cargo test ai::tests::chats_with_claude -- --ignored`
    #[test]
    #[ignore]
    fn chats_with_claude() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("cats.md"), "# Cats\n\nThe cat is called Mirtillo.\n").unwrap();
        let program = find_claude().expect("claude is installed");
        let (send, receive) = std::sync::mpsc::channel::<String>();
        let events = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                let _ = send.send(serde_json::from_str(&json).unwrap_or(json));
            }
            Ok(())
        });
        let mut session = start(&program, dir.path(), None, events).unwrap();
        let line = json!({ "type": "user", "message": { "role": "user", "content": "What's the cat called? One word." } });
        writeln!(session.stdin, "{line}").unwrap();
        session.stdin.flush().unwrap();
        let mut answer = None;
        while let Ok(line) = receive.recv_timeout(Duration::from_secs(120)) {
            let event: serde_json::Value = serde_json::from_str(&line).unwrap();
            if event["type"] == "result" {
                answer = event["result"].as_str().map(str::to_string);
                break;
            }
        }
        let _ = session.child.kill();
        assert!(answer.expect("an answer").contains("Mirtillo"));
        assert!(session.id.lock().unwrap().is_some());
    }
}
