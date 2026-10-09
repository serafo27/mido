//! The assistant: a chat about the open folder's documents with the AI
//! installed on the computer (Claude Code), in a panel next to the document.
//!
//! Mido doesn't talk to a model itself: it runs the `claude` command line the
//! user installed and signed in to, in the window's open folder, and passes
//! messages to it as JSON lines on its input. Its output, JSON lines as well
//! (`--output-format stream-json`), goes to the webview as is: the panel reads
//! the text, the files it reads and the session to resume (src/lib/ai.ts).
//!
//! What it can read depends on the panel's scope: the documents open in the
//! window (sent with the messages; it gets no tools to read), the folder, or
//! every folder open in Mido. With the tools that read files (Read, Grep,
//! Glob) only, confined to those folders, without the user's settings or MCP
//! servers (`--restricted`).
//!
//! It writes freely only in the project's notes folder (`ai/` unless the user
//! picked another): summaries, answers saved as files. Writing anywhere else
//! needs the user's permission: it asks on its output (`--permission-prompt-tool
//! stdio`, a `control_request`), the panel shows the change, and the answer
//! goes back on its input (`ai_answer`).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde_json::json;
use tauri::ipc::Channel;
use tauri::{Manager, Runtime, State, WebviewWindow};

/// What the assistant may use: reading and searching the folder's files, and writing in its notes folder.
const TOOLS: &[&str] = &["Read", "Grep", "Glob", "Write", "Edit"];
/// With the open files, which come with the messages: only writing.
const WRITE_TOOLS: &[&str] = &["Write"];
/// Where it writes unless the user picked another folder.
const DEFAULT_NOTES: &str = "ai";
/// The most of its error output kept, to tell why it stopped.
const MAX_STDERR: usize = 8 * 1024;
/// How long finding `claude` through the user's shell may take.
const SHELL_TIMEOUT: Duration = Duration::from_secs(8);

const SYSTEM_PROMPT: &str = "You are the assistant in Mido, a Markdown reader and editor. \
The user is reading the documents in the current working directory and chats with you in a panel next to them. \
Answer questions about these documents, explain them, and point to the files and sections you used, \
with paths relative to the folder. Reply in Markdown, concisely, in the language the user writes in.";

/// What the assistant can read.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    /// The documents open in the window, which the panel sends with the messages.
    OpenFiles,
    /// The window's folder.
    Project,
    /// Every folder open in Mido.
    AllProjects,
}

/// How an assistant was started: when it changes, it starts again (resuming the conversation).
#[derive(PartialEq, Eq, Debug)]
struct Setup {
    root: PathBuf,
    scope: Scope,
    /// The other folders it may read (all projects).
    others: Vec<PathBuf>,
    /// Where in the folder it may write, relative to it.
    notes: String,
}

/// A notes folder is a plain relative path inside the project: no `..`, no root, nothing a permission rule reads otherwise.
fn valid_notes_folder(folder: &str) -> bool {
    let parts: Vec<_> = folder.split('/').collect();
    !folder.is_empty()
        && folder.len() <= 100
        && parts.iter().all(|p| !p.is_empty() && *p != "." && *p != "..")
        && folder.chars().all(|c| c.is_alphanumeric() || " _-./".contains(c))
}

impl Setup {
    fn new(root: PathBuf, scope: Scope, mut others: Vec<PathBuf>, notes: &str) -> Setup {
        let notes = notes.trim().trim_matches('/');
        let notes = if valid_notes_folder(notes) { notes } else { DEFAULT_NOTES };
        if scope == Scope::AllProjects {
            // Those inside the folder are in it already.
            others.retain(|o| !o.starts_with(&root) && o.is_dir());
            others.sort();
            others.dedup();
        } else {
            others.clear();
        }
        Setup { root, scope, others, notes: notes.to_string() }
    }

    fn tools(&self) -> &'static [&'static str] {
        if self.scope == Scope::OpenFiles { WRITE_TOOLS } else { TOOLS }
    }

    /// The permission rule for writing: anything in the notes folder (Edit rules cover Write too).
    fn write_rule(&self) -> String {
        format!("Edit(./{}/**)", self.notes)
    }

    fn system_prompt(&self) -> String {
        let notes = &self.notes;
        let writing = if self.scope == Scope::OpenFiles {
            format!(
                " When the user asks you to write something to a file (notes, a summary, an answer), create a \
                 Markdown file in the project's `{notes}/` folder, with a short descriptive kebab-case name, and say \
                 which. You can't change the user's documents in this conversation: if asked to, show the change in \
                 your reply instead."
            )
        } else {
            format!(
                " When the user asks you to write something to a file (notes, a summary, an answer), create a \
                 Markdown file in the project's `{notes}/` folder, with a short descriptive kebab-case name, and say \
                 which: you can write there freely. You can also change the user's other documents when they ask \
                 you to (Edit, or Write for a new file): Mido shows them each change to approve. If they decline \
                 one, don't try it again: show the change in your reply instead."
            )
        };
        let scope = match self.scope {
            Scope::OpenFiles => format!(
                "{SYSTEM_PROMPT} In this conversation you can't read files: the user's messages include the documents \
                 they have open, each in a <document path=\"…\"> tag, sent again when it changes. Answer from those."
            ),
            Scope::Project => format!("{SYSTEM_PROMPT} Read the folder's files as needed."),
            Scope::AllProjects => {
                let others: Vec<_> = self.others.iter().map(|o| format!("- {}", o.display())).collect();
                let others = if others.is_empty() { "(none right now)".to_string() } else { others.join("\n") };
                format!(
                    "{SYSTEM_PROMPT} Read the files as needed. Besides this folder, the user has these folders open \
                     in Mido, which you can read too (give their files' full paths):\n{others}\n"
                )
            }
        };
        scope + &writing
    }
}

/// A line from the assistant: one of its JSON events, or Mido's own `{"type":"mido_exit"}` when it stops.
type EventChannel = Channel<String>;

/// The assistant running for a window: one process, kept for the whole conversation.
/// The assistant's input, shared by the messages and the answers to its requests.
type Input = Arc<Mutex<ChildStdin>>;

fn write_line(input: &Input, line: &serde_json::Value) -> Result<(), String> {
    let mut input = input.lock().map_err(crate::err)?;
    writeln!(input, "{line}").map_err(crate::err)?;
    input.flush().map_err(crate::err)
}

/// Its requests to write outside the notes folder, waiting for the user: what it asked to write, by request id.
type Pending = Arc<Mutex<HashMap<String, serde_json::Value>>>;

/// The tools it asks permission for: those that write.
const ASKS_FOR: &[&str] = &["Write", "Edit"];

struct Session {
    setup: Setup,
    pending: Pending,
    /// The conversation it resumed or started (its first event says which).
    id: Arc<Mutex<Option<String>>>,
    child: Child,
    stdin: Input,
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

/// The command line for the assistant set up as `setup`, resuming `session` if given.
fn command(program: &Path, setup: &Setup, session: Option<&str>) -> Command {
    let mut command = Command::new(program);
    command.args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]);
    command.args(["--include-partial-messages", "--restricted", "--strict-mcp-config"]);
    command.arg("--tools").args(setup.tools());
    command.arg("--allowedTools").arg(setup.write_rule());
    // Writing elsewhere: it asks, on its output.
    command.args(["--permission-prompt-tool", "stdio"]);
    if !setup.others.is_empty() {
        command.arg("--add-dir").args(&setup.others);
    }
    command.arg("--append-system-prompt").arg(setup.system_prompt());
    if let Some(session) = session {
        command.args(["--resume", session]);
    }
    command.current_dir(&setup.root);
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

/// Starts the assistant set up as `setup`, sending its events to `events`.
fn start(program: &Path, setup: Setup, session: Option<&str>, events: EventChannel) -> Result<Session, String> {
    let mut child = command(program, &setup, session).spawn().map_err(crate::err)?;
    let stdin: Input = Arc::new(Mutex::new(child.stdin.take().ok_or("The assistant has no input")?));
    let pending = Pending::default();
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
    let (input, asked) = (stdin.clone(), pending.clone());
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
                if event["type"] == "control_request" {
                    let request = &event["request"];
                    let asks = request["subtype"] == "can_use_tool"
                        && ASKS_FOR.iter().any(|t| request["tool_name"] == *t);
                    match event["request_id"].as_str() {
                        // The panel asks the user.
                        Some(id) if asks => {
                            if let Ok(mut asked) = asked.lock() {
                                asked.insert(id.to_string(), request["input"].clone());
                            }
                        }
                        // Nothing else is expected: it's refused.
                        Some(id) => {
                            let _ = write_line(&input, &refusal(id, "Mido doesn't support that request."));
                            continue;
                        }
                        None => continue,
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

    Ok(Session { setup, pending, id, child, stdin, events })
}

/// Where `claude` is installed, or null when it isn't (the panel then explains how to install it).
#[tauri::command]
pub async fn ai_detect(assistants: State<'_, Assistants>) -> Result<Option<String>, String> {
    Ok(assistants.program().map(|p| p.to_string_lossy().into_owned()))
}

/// The folders open in the other windows: what "all projects" adds.
#[tauri::command]
pub async fn ai_projects<R: Runtime>(window: WebviewWindow<R>) -> Result<Vec<String>, String> {
    let others = window.state::<crate::Workspaces>().others(window.label())?;
    Ok(others.iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

/// Sends a message to the window's assistant, starting it in the window's
/// folder if it isn't running (resuming `session`, the conversation the panel
/// shows, if given). It reads what `scope` lets it. Its events, from now on,
/// go to `on_event`.
#[tauri::command]
pub async fn ai_send<R: Runtime>(
    window: WebviewWindow<R>,
    assistants: State<'_, Assistants>,
    message: String,
    session: Option<String>,
    scope: Scope,
    notes_folder: String,
    on_event: EventChannel,
) -> Result<(), String> {
    // The folders come from the backend, not the webview.
    let workspaces = window.state::<crate::Workspaces>();
    let root = workspaces.root(window.label())?.filter(|p| p.is_dir()).ok_or("Open a folder to chat about it")?;
    let setup = Setup::new(root, scope, workspaces.others(window.label())?, &notes_folder);
    let session = session.filter(|s| valid_session(s));
    let label = window.label().to_string();

    let mut running = assistants.running.lock().map_err(crate::err)?;
    // The one running is set up otherwise or for another conversation, or has stopped: start again.
    if let Some(current) = running.get_mut(&label) {
        let same_session = current.id.lock().map(|id| *id == session).unwrap_or(false);
        let alive = matches!(current.child.try_wait(), Ok(None));
        if current.setup != setup || !same_session || !alive {
            let _ = current.child.kill();
            let _ = current.child.wait();
            running.remove(&label);
        }
    }
    if !running.contains_key(&label) {
        let program = assistants.program().ok_or("Claude Code isn't installed")?;
        let started = start(&program, setup, session.as_deref(), on_event.clone())?;
        running.insert(label.clone(), started);
    }
    let current = running.get_mut(&label).ok_or("The assistant has stopped")?;
    *current.events.lock().map_err(crate::err)? = on_event;
    write_line(&current.stdin, &json!({ "type": "user", "message": { "role": "user", "content": message } }))
}

fn refusal(request_id: &str, message: &str) -> serde_json::Value {
    json!({ "type": "control_response", "response": { "subtype": "success", "request_id": request_id,
        "response": { "behavior": "deny", "message": message } } })
}

/// Whether `path` is one the assistant may be allowed to write: in the folder, or another one it reads.
fn writable(setup: &Setup, path: &str) -> bool {
    let path = Path::new(path);
    let plain = path.is_absolute() && path.components().all(|c| !matches!(c, std::path::Component::ParentDir));
    let inside = |dir: &Path| {
        path.starts_with(dir) || dir.canonicalize().is_ok_and(|dir| path.starts_with(dir))
    };
    plain && std::iter::once(&setup.root).chain(&setup.others).any(|dir| inside(dir))
}

/// The answer to a request to write: allowed (with what it asked to write, as it asked) or not.
fn permission(setup: &Setup, request_id: &str, input: serde_json::Value, allow: bool) -> serde_json::Value {
    let path = input["file_path"].as_str().unwrap_or_default();
    if !allow {
        return refusal(request_id, "The user declined this change.");
    }
    if !writable(setup, path) {
        return refusal(request_id, "Mido only lets the assistant write in the folders open in it.");
    }
    json!({ "type": "control_response", "response": { "subtype": "success", "request_id": request_id,
        "response": { "behavior": "allow", "updatedInput": input } } })
}

/// Answers the assistant's request to write a file (`request_id`, from its
/// `control_request`): what the user decided in the panel.
#[tauri::command]
pub async fn ai_answer<R: Runtime>(
    window: WebviewWindow<R>,
    assistants: State<'_, Assistants>,
    request_id: String,
    allow: bool,
) -> Result<(), String> {
    let running = assistants.running.lock().map_err(crate::err)?;
    let session = running.get(window.label()).ok_or("The assistant has stopped")?;
    // Only what it asked, and as it asked it: the webview only says yes or no.
    let input = session.pending.lock().map_err(crate::err)?.remove(&request_id);
    let input = input.ok_or("The assistant isn't waiting for that anymore")?;
    write_line(&session.stdin, &permission(&session.setup, &request_id, input, allow))
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

    fn args(setup: &Setup, session: Option<&str>) -> (Command, Vec<String>) {
        let command = command(Path::new("/opt/claude/bin/claude"), setup, session);
        let args = command.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        (command, args)
    }

    #[test]
    fn runs_with_the_reading_tools_only_in_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let setup = Setup::new(dir.path().to_path_buf(), Scope::Project, vec![PathBuf::from("/elsewhere")], "ai");
        let (command, args) = args(&setup, Some("abc-123"));
        assert!(args.contains(&"--restricted".to_string()));
        let tools = args.iter().position(|a| a == "--tools").unwrap();
        assert_eq!(&args[tools + 1..tools + 1 + TOOLS.len()], TOOLS);
        assert!(args.windows(2).any(|w| w == ["--allowedTools", "Edit(./ai/**)"]));
        assert!(!args.contains(&"--add-dir".to_string()));
        assert!(args.windows(2).any(|w| w == ["--resume", "abc-123"]));
        assert_eq!(command.get_current_dir(), Some(dir.path()));
        let path = command.get_envs().find(|(k, _)| *k == "PATH").and_then(|(_, v)| v).unwrap();
        assert!(path.to_string_lossy().starts_with("/opt/claude/bin"));
    }

    #[test]
    fn only_writes_for_the_open_files() {
        let setup = Setup::new(PathBuf::from("/docs"), Scope::OpenFiles, vec![], "ai");
        let (_, args) = args(&setup, None);
        let tools = args.iter().position(|a| a == "--tools").unwrap();
        assert_eq!(&args[tools + 1..tools + 3], ["Write", "--allowedTools"]);
        assert!(setup.system_prompt().contains("can't read files"));
    }

    #[test]
    fn writes_only_in_a_plain_notes_folder() {
        let at = |folder: &str| Setup::new(PathBuf::from("/docs"), Scope::Project, vec![], folder).write_rule();
        assert_eq!(at("docs/ai notes/"), "Edit(./docs/ai notes/**)");
        assert_eq!(at("../outside"), "Edit(./ai/**)");
        assert_eq!(at("/etc"), "Edit(./etc/**)");
        assert_eq!(at("a/./b"), "Edit(./ai/**)");
        assert_eq!(at("*"), "Edit(./ai/**)");
        assert_eq!(at(""), "Edit(./ai/**)");
    }

    #[test]
    fn reads_the_other_open_folders_for_all_projects() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let inside = root.path().join("sub");
        std::fs::create_dir(&inside).unwrap();
        let others = vec![other.path().to_path_buf(), inside, PathBuf::from("/gone"), other.path().to_path_buf()];
        let setup = Setup::new(root.path().to_path_buf(), Scope::AllProjects, others, "ai");
        assert_eq!(setup.others, vec![other.path().to_path_buf()]);
        let (_, args) = args(&setup, None);
        assert!(args.windows(2).any(|w| w[0] == "--add-dir" && w[1] == other.path().to_string_lossy()));
        assert!(setup.system_prompt().contains(&other.path().display().to_string()));
    }

    /// Asks the real `claude` in `setup` and returns its answer and the tools it used. It needs it installed and
    /// signed in, and spends a little of the user's plan: `cargo test ai::tests::real -- --ignored`
    fn ask_claude(setup: Setup, message: &str) -> (String, Vec<String>) {
        ask_claude_allowing(setup, message, false)
    }

    fn ask_claude_allowing(setup: Setup, message: &str, allow: bool) -> (String, Vec<String>) {
        let program = find_claude().expect("claude is installed");
        let (send, receive) = std::sync::mpsc::channel::<String>();
        let events = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                let _ = send.send(serde_json::from_str(&json).unwrap_or(json));
            }
            Ok(())
        });
        let mut session = start(&program, setup, None, events).unwrap();
        write_line(&session.stdin, &json!({ "type": "user", "message": { "role": "user", "content": message } })).unwrap();
        let mut tools = Vec::new();
        let mut answer = None;
        while let Ok(line) = receive.recv_timeout(Duration::from_secs(120)) {
            let event: serde_json::Value = serde_json::from_str(&line).unwrap();
            if event["type"] == "assistant" {
                for block in event["message"]["content"].as_array().into_iter().flatten() {
                    if block["type"] == "tool_use" {
                        tools.push(block["name"].as_str().unwrap_or_default().to_string());
                    }
                }
            }
            // Writing elsewhere: allowed, if the test says so.
            if event["type"] == "control_request" {
                let id = event["request_id"].as_str().unwrap();
                let input = session.pending.lock().unwrap().remove(id).unwrap();
                write_line(&session.stdin, &permission(&session.setup, id, input, allow)).unwrap();
            }
            if event["type"] == "result" {
                answer = event["result"].as_str().map(str::to_string);
                break;
            }
        }
        let _ = session.child.kill();
        assert!(session.id.lock().unwrap().is_some());
        (answer.expect("an answer"), tools)
    }

    #[test]
    #[ignore]
    fn real_project() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("cats.md"), "# Cats\n\nThe cat is called Mirtillo.\n").unwrap();
        let setup = Setup::new(dir.path().to_path_buf(), Scope::Project, vec![], "ai");
        let (answer, tools) = ask_claude(setup, "What's the cat called? One word.");
        assert!(answer.contains("Mirtillo"), "{answer}");
        assert!(!tools.is_empty());
    }

    #[test]
    #[ignore]
    fn real_all_projects() {
        let dir = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        std::fs::write(other.path().join("dogs.md"), "# Dogs\n\nThe dog is called Brontolo.\n").unwrap();
        let setup = Setup::new(dir.path().to_path_buf(), Scope::AllProjects, vec![other.path().to_path_buf()], "ai");
        let (answer, _) = ask_claude(setup, "In the other open folder, what's the dog called? One word.");
        assert!(answer.contains("Brontolo"), "{answer}");
    }

    #[test]
    #[ignore]
    fn real_open_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("secret.md"), "The password is Zucchina.\n").unwrap();
        let setup = Setup::new(dir.path().to_path_buf(), Scope::OpenFiles, vec![], "ai");
        let message = "<document path=\"birds.md\">\nThe bird is called Pippo.\n</document>\n\n\
                       What's the bird called, and what's in secret.md? One line.";
        let (answer, tools) = ask_claude(setup, message);
        assert!(answer.contains("Pippo"), "{answer}");
        assert!(!answer.contains("Zucchina"), "{answer}");
        assert!(tools.is_empty());
    }

    #[test]
    #[ignore]
    fn real_writes_only_notes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("cats.md"), "# Cats\n\nThe cat is called Mirtillo.\n").unwrap();
        let setup = Setup::new(dir.path().to_path_buf(), Scope::Project, vec![], "notes/ai");
        let (_, tools) = ask_claude(
            setup,
            "Write a one-line summary of cats.md to a file, then add the line \"Edited.\" at the end of cats.md.",
        );
        assert!(tools.contains(&"Write".to_string()), "{tools:?}");
        let notes: Vec<_> = std::fs::read_dir(dir.path().join("notes/ai")).unwrap().flatten().collect();
        assert_eq!(notes.len(), 1);
        let cats = std::fs::read_to_string(dir.path().join("cats.md")).unwrap();
        assert!(!cats.contains("Edited"), "{cats}");
    }

    #[test]
    #[ignore]
    fn real_asks_to_edit() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("cats.md"), "# Cats\n\nThe cat is called Mirtillo.\n").unwrap();
        let setup = Setup::new(dir.path().to_path_buf(), Scope::Project, vec![], "ai");
        ask_claude_allowing(setup, "Add the line \"Edited.\" at the end of cats.md.", true);
        let cats = std::fs::read_to_string(dir.path().join("cats.md")).unwrap();
        assert!(cats.contains("Edited."), "{cats}");
    }

    #[test]
    fn allows_writing_only_in_its_folders() {
        let root = tempfile::tempdir().unwrap();
        let setup = Setup::new(root.path().to_path_buf(), Scope::Project, vec![], "ai");
        let inside = root.path().join("cats.md").to_string_lossy().into_owned();
        assert!(writable(&setup, &inside));
        assert!(!writable(&setup, "/etc/hosts"));
        assert!(!writable(&setup, &format!("{}/../x.md", root.path().display())));
        assert!(!writable(&setup, "cats.md"));
        let input = json!({ "file_path": inside, "content": "x" });
        let allowed = permission(&setup, "r1", input.clone(), true);
        assert_eq!(allowed["response"]["response"]["behavior"], "allow");
        assert_eq!(allowed["response"]["response"]["updatedInput"], input);
        assert_eq!(permission(&setup, "r1", input, false)["response"]["response"]["behavior"], "deny");
        let outside = permission(&setup, "r2", json!({ "file_path": "/etc/hosts" }), true);
        assert_eq!(outside["response"]["response"]["behavior"], "deny");
    }
}
