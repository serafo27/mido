use std::fs;
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

#[tauri::command]
fn read_tree(root: String) -> Result<Vec<FileNode>, String> {
    let root = PathBuf::from(root);
    if !root.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }
    Ok(build_tree(&root, 0))
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(err)
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(err)
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
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
fn create_dir(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if path.exists() {
        return Err(format!("{} already exists", path.display()));
    }
    fs::create_dir_all(&path).map_err(err)
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    let to_path = PathBuf::from(&to);
    if to_path.exists() {
        return Err(format!("{} already exists", to_path.display()));
    }
    fs::rename(&from, &to_path).map_err(err)
}

/// Moves the path to the OS trash instead of deleting it permanently.
#[tauri::command]
fn trash_path(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(err)
}

#[tauri::command]
fn watch_folder(app: AppHandle, state: State<WatcherState>, root: String) -> Result<(), String> {
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
