mod assets;
mod comments;
mod floating;
mod folders;
mod git;
mod search;
mod terminal;

use std::collections::HashMap;
use std::fs;
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use tauri::ipc::{CommandArg, CommandItem, InvokeError};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow, WebviewWindowBuilder};

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mdx"];
const IGNORED_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "__pycache__"];
const MAX_DEPTH: usize = 16;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileNode>>,
}

/// The label of the window Mido opens at launch. It's the one whose folder and
/// tabs are remembered across launches.
const MAIN_WINDOW: &str = "main";

/// The folder open in a window. File commands only accept paths inside it, and
/// only folders the user granted can be opened (see `GrantedFolders`), so even
/// a compromised webview (say, a malicious Markdown file getting past the
/// sanitizer) can't read or write the rest of the disk.
///
/// Commands take it as an argument: it's the folder of the window that called.
struct Workspace {
    root: PathBuf,
}

impl Workspace {
    /// `path`, normalised, if it's inside the open folder.
    fn resolve(&self, path: &str) -> Result<PathBuf, String> {
        resolve_inside(&self.root, path)
    }

    /// Errs unless changing `path` stays inside the open folder once symlinks
    /// are followed. Reads may follow a symlink out of the folder; writes may not.
    fn writable(&self, path: &Path) -> Result<(), String> {
        writable_inside(&self.root, path)
    }

    /// Like `resolve`, but refuses the open folder itself.
    fn resolve_entry(&self, path: &str) -> Result<PathBuf, String> {
        let path = resolve_inside(&self.root, path)?;
        if path == self.root {
            return Err("The open folder itself can't be changed".to_string());
        }
        Ok(path)
    }
}

impl<'de, R: Runtime> CommandArg<'de, R> for Workspace {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        let webview = command.message.webview_ref();
        // A floating window (the commit dialog's) works on its window's folder.
        let label = floating::owner(webview.app_handle(), webview.label());
        let root = webview.state::<Workspaces>().root(&label)?;
        root.map(|root| Workspace { root })
            .ok_or_else(|| InvokeError::from("No folder is open"))
    }
}

/// A window's open folder, with the watcher that reports its changes.
struct OpenFolder {
    root: PathBuf,
    /// Dropping it stops the watch.
    _watcher: Debouncer<RecommendedWatcher>,
}

/// The folder each window has open, by window label.
#[derive(Default)]
pub(crate) struct Workspaces(Mutex<HashMap<String, OpenFolder>>);

impl Workspaces {
    pub(crate) fn root(&self, window: &str) -> Result<Option<PathBuf>, String> {
        Ok(self.0.lock().map_err(err)?.get(window).map(|f| f.root.clone()))
    }

    /// The window that has a folder containing `path` open, if any.
    fn window_with(&self, path: &Path) -> Option<String> {
        let folders = self.0.lock().ok()?;
        folders.iter().find(|(_, f)| path.starts_with(&f.root)).map(|(label, _)| label.clone())
    }
}

/// The folders the user let Mido open, saved across launches.
struct GrantedFolders(Mutex<folders::Granted>);

impl GrantedFolders {
    fn contains(&self, folder: &Path) -> Result<bool, String> {
        Ok(self.0.lock().map_err(err)?.contains(folder))
    }

    fn grant(&self, folder: &Path) -> Result<(), String> {
        self.0.lock().map_err(err)?.grant(folder).map_err(err)
    }
}

/// A file or folder the system asked Mido to open: from the Finder, the Dock
/// or the command line.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct OpenRequest {
    path: String,
    is_dir: bool,
}

/// Open requests not yet taken by their window, by window label. They can
/// arrive before its webview has loaded (when a file launches Mido), so they
/// wait here instead of being sent as event payloads that nobody might be
/// listening to yet.
#[derive(Default)]
struct OpenRequests(Mutex<HashMap<String, Vec<OpenRequest>>>);

/// The folders and Markdown files among `paths`, made absolute. Anything else
/// (other file types, missing paths, stray arguments) is ignored.
fn open_requests(paths: impl IntoIterator<Item = PathBuf>) -> Vec<OpenRequest> {
    paths
        .into_iter()
        .filter_map(|p| normalize(&std::path::absolute(p).ok()?))
        .filter_map(|p| {
            let is_dir = p.is_dir();
            (is_dir || (p.is_file() && is_markdown(&p))).then(|| OpenRequest {
                path: p.to_string_lossy().into_owned(),
                is_dir,
            })
        })
        .collect()
}

/// The window to open `path` in: the one that already has it open, else the
/// one in front, else the main one (which may not have loaded yet, at launch),
/// else any.
fn window_for(app: &AppHandle, path: &Path) -> String {
    if let Some(label) = app.state::<Workspaces>().window_with(path) {
        return label;
    }
    if let Some(window) = front_window(app) {
        return window.label().to_string();
    }
    // "main" sorts before the "window-…" labels of the others.
    let mut labels: Vec<String> = app.webview_windows().into_keys().filter(|l| !floating::is_floating(l)).collect();
    labels.sort();
    labels.into_iter().next().unwrap_or_else(|| MAIN_WINDOW.to_string())
}

fn focused_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.webview_windows().into_values().find(|w| w.is_focused().unwrap_or(false))
}

/// The app window in front: the focused one, or the one a focused floating terminal came from.
fn front_window(app: &AppHandle) -> Option<WebviewWindow> {
    let window = focused_window(app)?;
    if floating::is_floating(window.label()) {
        floating::parent(app, window.label())
    } else {
        Some(window)
    }
}

fn queue_open_requests(app: &AppHandle, paths: impl IntoIterator<Item = PathBuf>) {
    let requests = open_requests(paths);
    if requests.is_empty() {
        return;
    }
    // The user opened these from outside the webview: their folders are granted.
    if let Some(granted) = app.try_state::<GrantedFolders>() {
        for request in &requests {
            let path = Path::new(&request.path);
            let folder = if request.is_dir { Some(path) } else { path.parent() };
            if let Some(folder) = folder {
                let _ = granted.grant(folder);
            }
        }
    }
    let mut windows = Vec::new();
    if let Ok(mut pending) = app.state::<OpenRequests>().0.lock() {
        for request in requests {
            let window = window_for(app, Path::new(&request.path));
            pending.entry(window.clone()).or_default().push(request);
            windows.push(window);
        }
    }
    // Tells each window to take its requests, if it's already listening.
    windows.dedup();
    for window in windows {
        let _ = app.emit_to(window.as_str(), "open-requests", ());
    }
}

#[tauri::command]
fn take_open_requests(window: WebviewWindow, pending: State<OpenRequests>) -> Vec<OpenRequest> {
    pending.0.lock().ok().and_then(|mut p| p.remove(window.label())).unwrap_or_default()
}

/// Resolves `.` and `..` without touching the disk, since the path may not
/// exist yet. Returns `None` for relative paths and for `..` above the root.
fn normalize(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            other => out.push(other),
        }
    }
    Some(out)
}

/// The check is on the path as written: symlinks inside the folder that point
/// elsewhere still work, as the sidebar lists them.
fn resolve_inside(root: &Path, path: &str) -> Result<PathBuf, String> {
    match normalize(Path::new(path)) {
        Some(resolved) if resolved.starts_with(root) => Ok(resolved),
        _ => Err(format!("{path} is outside the open folder")),
    }
}

/// The folder `path` is in (`path` itself if it has none).
fn parent_of(path: &Path) -> &Path {
    path.parent().unwrap_or(path)
}

/// Errs unless `path`, or its nearest existing ancestor when it doesn't exist
/// yet, is inside `root` on disk, symlinks resolved. Pass a symlink's parent to
/// allow changing the link itself, or the link to check what it points to.
fn writable_inside(root: &Path, path: &Path) -> Result<(), String> {
    let root = fs::canonicalize(root).map_err(err)?;
    let real = path.ancestors().find_map(|p| fs::canonicalize(p).ok());
    match real {
        Some(real) if real.starts_with(&root) => Ok(()),
        _ => Err(format!("{} is outside the open folder", path.display())),
    }
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| MARKDOWN_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// Builds the tree of a directory, keeping only markdown files and the
/// directories that (transitively) contain at least one of them.
fn build_tree(dir: &Path, depth: usize) -> Vec<FileNode> {
    if depth > MAX_DEPTH {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut dirs = Vec::new();
    let mut files = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_hidden(&name) {
            continue;
        }
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            if IGNORED_DIRS.contains(&name.as_str()) {
                continue;
            }
            let children = build_tree(&path, depth + 1);
            if !children.is_empty() {
                dirs.push(FileNode {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    is_dir: true,
                    children: Some(children),
                });
            }
        } else if (file_type.is_file() || (file_type.is_symlink() && path.is_file()))
            && is_markdown(&path)
        {
            files.push(FileNode {
                name,
                path: path.to_string_lossy().into_owned(),
                is_dir: false,
                children: None,
            });
        }
    }

    let by_name = |a: &FileNode, b: &FileNode| {
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    };
    dirs.sort_by(by_name);
    files.sort_by(by_name);
    dirs.extend(files);
    dirs
}

pub(crate) fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// Commands are `async` so they run off the main thread: a sync Tauri command
// runs on the main thread and would freeze the window while it works.

/// Asks for a folder in the native dialog and grants it. The dialog runs here
/// rather than in the webview, so the choice is always the user's. Returns
/// `None` if the dialog was cancelled.
#[tauri::command]
async fn pick_folder(app: AppHandle, granted: State<'_, GrantedFolders>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let Some(chosen) = app.dialog().file().set_title("Open Folder").blocking_pick_folder() else {
        return Ok(None);
    };
    let folder = chosen.into_path().map_err(err)?;
    let folder = normalize(&folder).ok_or_else(|| format!("{} is not a folder", folder.display()))?;
    granted.grant(&folder)?;
    Ok(Some(folder.to_string_lossy().into_owned()))
}

/// Asks the user, in a native prompt the webview can't fake or skip, whether
/// Mido may open `folder`.
fn confirm_folder(app: &AppHandle, folder: &Path) -> bool {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    app.dialog()
        .message(format!(
            "Mido will be able to read and change the files in “{}”.",
            folder.display()
        ))
        .title("Open this folder?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Open".to_string(), "Cancel".to_string()))
        .blocking_show()
}

/// Makes `root` the calling window's open folder: its file commands, the
/// preview's images and the watcher are all limited to it. Returns its tree. A folder the user hasn't
/// granted yet (say, a recent folder from before grants were saved) needs
/// their confirmation first.
#[tauri::command]
async fn open_folder(
    app: AppHandle,
    window: WebviewWindow,
    workspaces: State<'_, Workspaces>,
    granted: State<'_, GrantedFolders>,
    root: String,
) -> Result<Vec<FileNode>, String> {
    let root = normalize(Path::new(&root))
        .filter(|r| r.is_dir())
        .ok_or_else(|| format!("{root} is not a folder"))?;
    if !granted.contains(&root)? {
        if !confirm_folder(&app, &root) {
            return Err(format!("Opening {} was cancelled", root.display()));
        }
        granted.grant(&root)?;
    }
    // Asset protocol scope entries can't be removed, so folders opened earlier
    // in the session stay readable as images; nothing else is.
    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(err)?;
    let watcher = watch(&app, window.label(), &root)?;
    // Replacing the window's previous folder drops its watcher, which stops the old watch.
    workspaces.0.lock().map_err(err)?.insert(
        window.label().to_string(),
        OpenFolder { root: root.clone(), _watcher: watcher },
    );
    tree(root).await
}

#[tauri::command]
async fn read_tree(workspace: Workspace) -> Result<Vec<FileNode>, String> {
    tree(workspace.root).await
}

async fn tree(root: PathBuf) -> Result<Vec<FileNode>, String> {
    // Walking a large folder can take a while; keep it off the async workers too.
    tauri::async_runtime::spawn_blocking(move || build_tree(&root, 0))
        .await
        .map_err(err)
}

/// The Markdown files of a tree, in display order.
fn markdown_files(nodes: Vec<FileNode>, out: &mut Vec<PathBuf>) {
    for node in nodes {
        match node.children {
            Some(children) => markdown_files(children, out),
            None => out.push(PathBuf::from(node.path)),
        }
    }
}

#[tauri::command]
async fn search_files(
    workspace: Workspace,
    query: String,
    options: search::SearchOptions,
) -> Result<search::SearchResults, String> {
    let root = workspace.root;
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        markdown_files(build_tree(&root, 0), &mut files);
        search::search(&files, &query, &options)
    })
    .await
    .map_err(err)
}

#[tauri::command]
async fn read_file(workspace: Workspace, path: String) -> Result<String, String> {
    fs::read_to_string(workspace.resolve(&path)?).map_err(err)
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
enum WriteOutcome {
    Written,
    /// The file on disk no longer matches `expected`: someone else changed it.
    Conflict,
}

/// Writes `content` to `path`, unless the file on disk differs from `expected`
/// (the contents Mido last read or wrote). `expected: None` overwrites anyway.
/// A missing file is never a conflict, so a deleted file can be saved again.
#[tauri::command]
async fn write_file(
    workspace: Workspace,
    path: String,
    content: String,
    expected: Option<String>,
) -> Result<WriteOutcome, String> {
    let path = workspace.resolve(&path)?;
    // The write goes through symlinks, so it's their target that must be inside.
    workspace.writable(&path)?;
    write_checked(&path, &content, expected.as_deref()).map_err(err)
}

fn write_checked(path: &Path, content: &str, expected: Option<&str>) -> io::Result<WriteOutcome> {
    if let Some(expected) = expected {
        match fs::read(path) {
            Ok(disk) if disk != expected.as_bytes() => return Ok(WriteOutcome::Conflict),
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    write_atomic(path, content.as_bytes())?;
    Ok(WriteOutcome::Written)
}

/// Writes to a temporary file next to `path` and renames it over the original,
/// so a crash or a full disk never leaves a truncated file behind.
fn write_atomic(path: &Path, content: &[u8]) -> io::Result<()> {
    // Write through symlinks, like a plain write would, instead of replacing them.
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let dir = target.parent().unwrap_or(Path::new("."));

    // The leading dot keeps the temporary file out of the tree and the watcher.
    let mut tmp = match tempfile::Builder::new()
        .prefix(".mido-")
        .suffix(".tmp")
        .tempfile_in(dir)
    {
        Ok(tmp) => tmp,
        // A writable file in a read-only folder: fall back to writing in place.
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => return fs::write(&target, content),
        Err(e) => return Err(e),
    };
    tmp.write_all(content)?;
    if let Ok(meta) = fs::metadata(&target) {
        tmp.as_file().set_permissions(meta.permissions())?;
    }
    tmp.as_file().sync_all()?;
    tmp.persist(&target).map_err(|e| e.error)?;
    Ok(())
}

#[tauri::command]
async fn create_file(workspace: Workspace, path: String) -> Result<(), String> {
    let path = workspace.resolve_entry(&path)?;
    workspace.writable(&path)?;
    if path.exists() {
        return Err(format!("{} already exists", path.display()));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let title = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    fs::write(&path, format!("# {title}\n\n")).map_err(err)
}

#[tauri::command]
async fn create_dir(workspace: Workspace, path: String) -> Result<(), String> {
    let path = workspace.resolve_entry(&path)?;
    workspace.writable(&path)?;
    if path.exists() {
        return Err(format!("{} already exists", path.display()));
    }
    fs::create_dir_all(&path).map_err(err)
}

#[tauri::command]
async fn rename_path(
    workspace: Workspace,
    from: String,
    to: String,
) -> Result<(), String> {
    let from = workspace.resolve_entry(&from)?;
    let to = workspace.resolve_entry(&to)?;
    let root = &workspace.root;
    // Renaming a symlink moves the link, not its target: check its folder.
    workspace.writable(parent_of(&from))?;
    workspace.writable(&to)?;
    if let (Some(old), Some(new)) = (comments::dir_for(root, &from), comments::dir_for(root, &to)) {
        workspace.writable(parent_of(&old))?;
        workspace.writable(&new)?;
    }
    if to.exists() {
        return Err(format!("{} already exists", to.display()));
    }
    fs::rename(&from, &to).map_err(err)?;
    comments::moved(root, &from, &to).map_err(err)
}

/// Saves an image pasted or dropped into the editor in the `assets` folder
/// next to the document, and returns its path relative to the document.
/// The image comes as the raw request body (no JSON encoding); the document
/// path, file name and MIME type come as percent-encoded headers.
#[tauri::command]
async fn save_asset(
    workspace: Workspace,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the image data".to_string());
    };
    let header = |name: &str| {
        let value = request.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("");
        percent_encoding::percent_decode_str(value).decode_utf8_lossy().into_owned()
    };
    let document = workspace.resolve(&header("x-document"))?;
    workspace.writable(&parent_of(&document).join(assets::ASSETS_DIR))?;
    assets::save(&document, &header("x-name"), &header("x-mime"), bytes).map_err(err)
}

/// Asks where to save an exported file, then writes it there. The save
/// dialog runs here rather than in the webview, so the destination outside
/// the open folder is always one the user picked. Returns the saved path, or
/// `None` if the dialog was cancelled.
fn save_export(
    app: &AppHandle,
    default_path: &str,
    title: &str,
    (filter, extension): (&str, &str),
    bytes: &[u8],
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let default_path = PathBuf::from(default_path);
    let mut dialog = app.dialog().file().set_title(title).add_filter(filter, &[extension]);
    if let Some(dir) = default_path.parent() {
        dialog = dialog.set_directory(dir);
    }
    if let Some(name) = default_path.file_name() {
        dialog = dialog.set_file_name(name.to_string_lossy());
    }
    let Some(chosen) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(err)?;
    write_atomic(&path, bytes).map_err(err)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Saves an exported HTML page where the user picks.
#[tauri::command]
async fn export_html(
    app: AppHandle,
    default_path: String,
    html: String,
) -> Result<Option<String>, String> {
    save_export(&app, &default_path, "Export as HTML", ("HTML", "html"), html.as_bytes())
}

/// Saves an exported Word document where the user picks. The file comes as
/// the raw request body; the suggested path as a percent-encoded header.
#[tauri::command]
async fn export_word(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the document data".to_string());
    };
    let value = request.headers().get("x-default-path").and_then(|v| v.to_str().ok()).unwrap_or("");
    let default_path = percent_encoding::percent_decode_str(value).decode_utf8_lossy();
    save_export(&app, &default_path, "Export as Word", ("Word Document", "docx"), bytes)
}

/// Moves the path to the OS trash instead of deleting it permanently, with its comments.
#[tauri::command]
async fn trash_path(workspace: Workspace, path: String) -> Result<(), String> {
    let path = workspace.resolve_entry(&path)?;
    // Trashing a symlink moves the link, not its target: check its folder.
    workspace.writable(parent_of(&path))?;
    let comments = comments::dir_for(&workspace.root, &path).filter(|d| d.exists());
    if let Some(dir) = &comments {
        workspace.writable(parent_of(dir))?;
    }
    trash::delete(&path).map_err(err)?;
    if let Some(dir) = comments {
        trash::delete(dir).map_err(err)?;
    }
    Ok(())
}

/// The comments folder of `document`, which must be inside the open folder.
fn comments_dir(workspace: &Workspace, document: &str) -> Result<PathBuf, String> {
    let document = workspace.resolve_entry(document)?;
    comments::dir_for(&workspace.root, &document).ok_or_else(|| "Not a document".to_string())
}

#[tauri::command]
async fn read_comments(
    workspace: Workspace,
    document: String,
) -> Result<Vec<comments::CommentFile>, String> {
    comments::read(&comments_dir(&workspace, &document)?).map_err(err)
}

#[tauri::command]
async fn add_comment_file(
    workspace: Workspace,
    document: String,
    thread: String,
    name: String,
    content: String,
) -> Result<(), String> {
    let dir = comments_dir(&workspace, &document)?;
    workspace.writable(&dir.join(&thread))?;
    comments::add(&dir, &thread, &name, &content).map_err(err)
}

#[tauri::command]
async fn compact_comment_thread(
    workspace: Workspace,
    document: String,
    thread: String,
    name: String,
    content: String,
    replaces: Vec<String>,
) -> Result<(), String> {
    let dir = comments_dir(&workspace, &document)?;
    workspace.writable(&dir.join(&thread))?;
    comments::compact(&dir, &thread, &name, &content, &replaces).map_err(err)
}

/// Who comments are signed by: the git user of the open folder, if any.
#[tauri::command]
async fn git_identity(workspace: Workspace) -> Result<Option<comments::Identity>, String> {
    let root = workspace.root;
    tauri::async_runtime::spawn_blocking(move || comments::git_identity(&root))
        .await
        .map_err(err)
}

/// Emits `fs-changed` to `window` with the changed paths whenever something in
/// `root` changes, and `comments-changed` when comments do (hidden folders are
/// otherwise ignored).
fn watch(app: &AppHandle, window: &str, root: &Path) -> Result<Debouncer<RecommendedWatcher>, String> {
    let handle = app.clone();
    let window = window.to_string();
    let comments_root = root.join(comments::COMMENTS_DIR);
    let mut debouncer = new_debouncer(
        Duration::from_millis(250),
        move |res: DebounceEventResult| {
            if let Ok(events) = res {
                let (comments, others): (Vec<_>, Vec<_>) =
                    events.into_iter().map(|e| e.path).partition(|p| p.starts_with(&comments_root));
                let paths: Vec<String> = others
                    .into_iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .filter(|p| !p.split(['/', '\\']).any(|seg| is_hidden(seg) && seg.len() > 1))
                    .collect();
                if !paths.is_empty() {
                    let _ = handle.emit_to(window.as_str(), "fs-changed", paths);
                }
                if !comments.is_empty() {
                    let _ = handle.emit_to(window.as_str(), "comments-changed", ());
                }
            }
        },
    )
    .map_err(err)?;

    debouncer
        .watcher()
        .watch(root, RecursiveMode::Recursive)
        .map_err(err)?;
    Ok(debouncer)
}

/// CPU architecture of this build ("aarch64" or "x86_64"), used to pick the
/// matching installer when an update is available.
#[tauri::command]
fn app_arch() -> &'static str {
    std::env::consts::ARCH
}

/// How far each new window sits from the one in front, so it doesn't hide it exactly.
const CASCADE: f64 = 28.0;

/// Opens another window, with no folder open: it shows the welcome screen.
fn new_window(app: &AppHandle) -> tauri::Result<()> {
    static NEXT: AtomicUsize = AtomicUsize::new(1);

    let Some(mut config) = app.config().app.windows.first().cloned() else {
        return Ok(());
    };
    config.label = format!("window-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let mut builder = WebviewWindowBuilder::from_config(app, &config)?;
    if let Some(front) = front_window(app) {
        let scale = front.scale_factor()?;
        let at = front.outer_position()?.to_logical::<f64>(scale);
        let size = front.inner_size()?.to_logical::<f64>(scale);
        builder = builder.position(at.x + CASCADE, at.y + CASCADE).inner_size(size.width, size.height);
    }
    builder.build()?;
    Ok(())
}

#[tauri::command]
async fn open_new_window(app: AppHandle) -> Result<(), String> {
    new_window(&app).map_err(err)
}

/// macOS app menu. It replaces Tauri's default one, whose "Close Window"
/// item would grab ⌘W before the webview can use it to close a tab. Undo/redo
/// are left out on purpose so ⌘Z reaches CodeMirror's own history.
#[cfg(target_os = "macos")]
fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let check_updates = MenuItemBuilder::with_id("check-updates", "Check for Updates…").build(app)?;
    let new_window = MenuItemBuilder::with_id("new-window", "New Window")
        .accelerator("CmdOrCtrl+Shift+N")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Mido")
        .item(&PredefinedMenuItem::about(app, Some("About Mido"), None)?)
        .item(&check_updates)
        .separator()
        .item(&new_window)
        .separator()
        .item(&settings)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;
    let export_html = MenuItemBuilder::with_id("export-html", "Export as HTML…")
        .accelerator("CmdOrCtrl+Shift+E")
        .build(app)?;
    let export_word = MenuItemBuilder::with_id("export-word", "Export as Word…")
        .accelerator("CmdOrCtrl+Alt+E")
        .build(app)?;
    let print = MenuItemBuilder::with_id("print", "Print…")
        .accelerator("CmdOrCtrl+Alt+P")
        .build(app)?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&export_html)
        .item(&export_word)
        .separator()
        .item(&print)
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;
    let new_terminal = MenuItemBuilder::with_id("new-terminal", "New Terminal")
        .accelerator("Ctrl+Shift+`")
        .build(app)?;
    let toggle_terminal = MenuItemBuilder::with_id("toggle-terminal", "Toggle Terminal")
        .accelerator("Ctrl+`")
        .build(app)?;
    let clear_terminal = MenuItemBuilder::with_id("clear-terminal", "Clear Terminal").build(app)?;
    let kill_terminal = MenuItemBuilder::with_id("kill-terminal", "Kill Terminal").build(app)?;
    let terminal_menu = SubmenuBuilder::with_id(app, "terminal-menu", "Terminal")
        .item(&new_terminal)
        .item(&toggle_terminal)
        .separator()
        .item(&clear_terminal)
        .item(&kill_terminal)
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    MenuBuilder::new(app).items(&[&app_menu, &file_menu, &edit_menu, &terminal_menu, &window_menu]).build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Workspaces::default())
        .manage(git::RepoLocks::default())
        .manage(OpenRequests::default())
        .manage(terminal::Terminals::default())
        .manage(floating::FloatingWindows::default())
        .setup(|app| {
            // Before the open requests below, which grant their folders.
            let granted = folders::Granted::load(app.path().app_data_dir()?.join("granted-folders.json"));
            app.manage(GrantedFolders(Mutex::new(granted)));
            let trusted = folders::Granted::load(app.path().app_data_dir()?.join("trusted-repositories.json"));
            app.manage(git::TrustedRepos(Mutex::new(trusted)));
            #[cfg(target_os = "macos")]
            {
                app.set_menu(build_menu(app.handle())?)?;
            }
            // `Mido.app/Contents/MacOS/mido notes/a.md`; `open -a Mido` and the
            // Finder go through `RunEvent::Opened` instead.
            queue_open_requests(app.handle(), std::env::args_os().skip(1).map(PathBuf::from));
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "new-window" {
                let _ = new_window(app);
                return;
            }
            let name = match event.id().as_ref() {
                "settings" => "menu-settings",
                "check-updates" => "menu-check-updates",
                "export-html" => "menu-export-html",
                "export-word" => "menu-export-word",
                "new-terminal" => "menu-new-terminal",
                "toggle-terminal" => "menu-toggle-terminal",
                "clear-terminal" => "menu-clear-terminal",
                "kill-terminal" => "menu-kill-terminal",
                "print" => "menu-print",
                _ => return,
            };
            // Only the window in front acts on the menu. A floating terminal
            // clears and kills its own terminal; the rest is its window's.
            let Some(focused) = focused_window(app) else { return };
            let own = floating::is_terminal(focused.label()) && matches!(name, "menu-clear-terminal" | "menu-kill-terminal");
            let window = if own { Some(focused.clone()) } else { front_window(app) };
            if let Some(window) = window {
                if window.label() != focused.label() {
                    let _ = window.set_focus();
                }
                let _ = window.emit_to(window.label(), name, ());
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let label = window.label();
                if let Ok(mut folders) = window.state::<Workspaces>().0.lock() {
                    // Stops watching its folder.
                    folders.remove(label);
                }
                if let Ok(mut pending) = window.state::<OpenRequests>().0.lock() {
                    pending.remove(label);
                }
                // Ends its shells, and closes its floating terminals.
                window.state::<terminal::Terminals>().close_window(label);
                floating::window_destroyed(window.app_handle(), label);
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_folder,
            pick_folder,
            take_open_requests,
            open_new_window,
            read_tree,
            search_files,
            read_file,
            write_file,
            create_file,
            create_dir,
            rename_path,
            trash_path,
            export_html,
            export_word,
            save_asset,
            terminal::pty_spawn,
            terminal::pty_write,
            terminal::pty_resize,
            terminal::pty_kill,
            terminal::pty_detach,
            terminal::pty_attach,
            floating::open_terminal_window,
            floating::terminal_window,
            floating::dock_terminal,
            floating::open_commit_window,
            floating::window_parent,
            read_comments,
            add_comment_file,
            compact_comment_thread,
            git_identity,
            git::git_info,
            git::git_trust,
            git::git_log,
            git::git_commit_files,
            git::git_file_versions,
            git::git_stage,
            git::git_unstage,
            git::git_commit,
            git::git_last_message,
            git::git_push,
            git::git_pull,
            git::git_fetch,
            git::git_resolve,
            git::git_discard,
            git::git_branches,
            git::git_checkout,
            git::git_create_branch,
            git::git_merge,
            git::git_delete_branch,
            git::git_outgoing,
            git::git_continue,
            git::git_abort,
            app_arch
        ])
        .build(tauri::generate_context!())
        .expect("error while building Mido")
        .run(|_app, _event| {
            // Files opened from the Finder, "Open With", the Dock icon or `open -a Mido`.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths = urls.into_iter().filter_map(|url| url.to_file_path().ok());
                queue_open_requests(_app, paths);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn accepts_paths_inside_the_root() {
        let root = Path::new("/notes");
        assert_eq!(resolve_inside(root, "/notes/a.md").unwrap(), Path::new("/notes/a.md"));
        assert_eq!(resolve_inside(root, "/notes/sub/../b.md").unwrap(), Path::new("/notes/b.md"));
        assert_eq!(resolve_inside(root, "/notes/./c.md").unwrap(), Path::new("/notes/c.md"));
        assert_eq!(resolve_inside(root, "/notes").unwrap(), Path::new("/notes"));
    }

    #[test]
    fn rejects_paths_outside_the_root() {
        let root = Path::new("/notes");
        for path in [
            "/notes/../etc/passwd",
            "/notes/sub/../../x.md",
            "/notes-other/a.md",
            "/etc/passwd",
            "notes/a.md",
            "../a.md",
            "/..",
            "",
        ] {
            assert!(resolve_inside(root, path).is_err(), "{path} should be rejected");
        }
    }

    #[cfg(unix)]
    #[test]
    fn refuses_writes_through_symlinks_leading_out() {
        use std::os::unix::fs::symlink;
        let outside = temp_dir();
        let dir = temp_dir();
        let root = dir.path();
        fs::write(outside.path().join("secret.md"), "").unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub/a.md"), "").unwrap();
        symlink(outside.path(), root.join("out")).unwrap();
        symlink(outside.path().join("secret.md"), root.join("secret.md")).unwrap();
        symlink(root.join("sub"), root.join("in")).unwrap();

        for ok in ["sub/a.md", "sub/new.md", "new/deep/b.md", "in/a.md", "in/new.md"] {
            assert!(writable_inside(root, &root.join(ok)).is_ok(), "{ok} should be writable");
        }
        for out in ["out", "out/secret.md", "out/new.md", "out/new/deep.md", "secret.md"] {
            assert!(writable_inside(root, &root.join(out)).is_err(), "{out} should be refused");
        }
        // The links themselves sit in the folder: they can be renamed or trashed.
        assert!(writable_inside(root, parent_of(&root.join("out"))).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn accepts_a_root_reached_through_a_symlink() {
        let dir = temp_dir();
        fs::create_dir(dir.path().join("real")).unwrap();
        std::os::unix::fs::symlink(dir.path().join("real"), dir.path().join("link")).unwrap();
        let root = dir.path().join("link");
        assert!(writable_inside(&root, &root.join("a.md")).is_ok());
    }

    #[test]
    fn keeps_only_folders_and_markdown_files_to_open() {
        let dir = temp_dir();
        let root = dir.path();
        fs::write(root.join("a.md"), "").unwrap();
        fs::write(root.join("b.txt"), "").unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        let requests = open_requests([
            root.join("a.md"),
            root.join("b.txt"),
            root.join("sub"),
            root.join("sub/../a.md"),
            root.join("missing.md"),
            PathBuf::from("-psn_0_12345"),
        ]);
        let file = |path: PathBuf, is_dir| OpenRequest { path: path.to_string_lossy().into_owned(), is_dir };
        assert_eq!(
            requests,
            vec![file(root.join("a.md"), false), file(root.join("sub"), true), file(root.join("a.md"), false)]
        );
    }

    #[test]
    fn writes_when_disk_matches_expected() {
        let dir = temp_dir();
        let path = dir.path().join("a.md");
        fs::write(&path, "old").unwrap();
        assert_eq!(write_checked(&path, "new", Some("old")).unwrap(), WriteOutcome::Written);
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn reports_conflict_and_keeps_the_disk_version() {
        let dir = temp_dir();
        let path = dir.path().join("a.md");
        fs::write(&path, "changed elsewhere").unwrap();
        assert_eq!(write_checked(&path, "mine", Some("old")).unwrap(), WriteOutcome::Conflict);
        assert_eq!(fs::read_to_string(&path).unwrap(), "changed elsewhere");
    }

    #[test]
    fn overwrites_without_expected() {
        let dir = temp_dir();
        let path = dir.path().join("a.md");
        fs::write(&path, "changed elsewhere").unwrap();
        assert_eq!(write_checked(&path, "mine", None).unwrap(), WriteOutcome::Written);
        assert_eq!(fs::read_to_string(&path).unwrap(), "mine");
    }

    #[test]
    fn recreates_a_deleted_file() {
        let dir = temp_dir();
        let path = dir.path().join("gone.md");
        assert_eq!(write_checked(&path, "back", Some("old")).unwrap(), WriteOutcome::Written);
        assert_eq!(fs::read_to_string(&path).unwrap(), "back");
    }

    #[test]
    fn leaves_no_temporary_files() {
        let dir = temp_dir();
        let path = dir.path().join("a.md");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        let names: Vec<_> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec!["a.md"]);
    }

    #[cfg(unix)]
    #[test]
    fn keeps_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir();
        let path = dir.path().join("a.md");
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        write_atomic(&path, b"new").unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o640);
    }

    #[cfg(unix)]
    #[test]
    fn writes_through_symlinks() {
        let dir = temp_dir();
        let real = dir.path().join("real.md");
        let link = dir.path().join("link.md");
        fs::write(&real, "old").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        write_atomic(&link, b"new").unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(&real).unwrap(), "new");
    }
}
