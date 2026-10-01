use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

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

#[derive(Default)]
struct WatcherState(Mutex<Option<Debouncer<RecommendedWatcher>>>);

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

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// Commands are `async` so they run off the main thread: a sync Tauri command
// runs on the main thread and would freeze the window while it works.

#[tauri::command]
async fn read_tree(root: String) -> Result<Vec<FileNode>, String> {
    let root = PathBuf::from(root);
    if !root.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }
    // Walking a large folder can take a while; keep it off the async workers too.
    tauri::async_runtime::spawn_blocking(move || build_tree(&root, 0))
        .await
        .map_err(err)
}

#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(err)
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
    path: String,
    content: String,
    expected: Option<String>,
) -> Result<WriteOutcome, String> {
    write_checked(Path::new(&path), &content, expected.as_deref()).map_err(err)
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
async fn create_file(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
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
async fn create_dir(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if path.exists() {
        return Err(format!("{} already exists", path.display()));
    }
    fs::create_dir_all(&path).map_err(err)
}

#[tauri::command]
async fn rename_path(from: String, to: String) -> Result<(), String> {
    let to_path = PathBuf::from(&to);
    if to_path.exists() {
        return Err(format!("{} already exists", to_path.display()));
    }
    fs::rename(&from, &to_path).map_err(err)
}

/// Moves the path to the OS trash instead of deleting it permanently.
#[tauri::command]
async fn trash_path(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(err)
}

#[tauri::command]
async fn watch_folder(
    app: AppHandle,
    state: State<'_, WatcherState>,
    root: String,
) -> Result<(), String> {
    let handle = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(250),
        move |res: DebounceEventResult| {
            if let Ok(events) = res {
                let paths: Vec<String> = events
                    .into_iter()
                    .map(|e| e.path.to_string_lossy().into_owned())
                    .filter(|p| !p.split(['/', '\\']).any(|seg| is_hidden(seg) && seg.len() > 1))
                    .collect();
                if !paths.is_empty() {
                    let _ = handle.emit("fs-changed", paths);
                }
            }
        },
    )
    .map_err(err)?;

    debouncer
        .watcher()
        .watch(Path::new(&root), RecursiveMode::Recursive)
        .map_err(err)?;

    // Replacing the previous debouncer drops it, which stops the old watch.
    *state.0.lock().map_err(err)? = Some(debouncer);
    Ok(())
}

/// CPU architecture of this build ("aarch64" or "x86_64"), used to pick the
/// matching installer when an update is available.
#[tauri::command]
fn app_arch() -> &'static str {
    std::env::consts::ARCH
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
    let app_menu = SubmenuBuilder::new(app, "Mido")
        .item(&PredefinedMenuItem::about(app, Some("About Mido"), None)?)
        .item(&check_updates)
        .separator()
        .item(&settings)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(WatcherState::default())
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            {
                let menu = build_menu(_app.handle())?;
                _app.set_menu(menu)?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let name = match event.id().as_ref() {
                "settings" => "menu-settings",
                "check-updates" => "menu-check-updates",
                _ => return,
            };
            let _ = app.emit(name, ());
        })
        .invoke_handler(tauri::generate_handler![
            read_tree,
            read_file,
            write_file,
            create_file,
            create_dir,
            rename_path,
            trash_path,
            watch_folder,
            app_arch
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mido");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
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
