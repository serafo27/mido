//! Floating windows: windows that belong to an app window, to place anywhere
//! on the desktop. They work on its folder, and close with it.
//!
//! - A terminal moved out of the window's panel. Closing it puts the terminal
//!   back in the panel.
//! - A git dialog: commit, or push. Its window keeps the git state and does
//!   the git work; the dialog shows it and asks for it, through events.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::terminal::Terminals;

const TERMINAL: &str = "terminal-";
const GIT: &str = "git-";

/// A terminal on its way to another window: the shell, and the screen to show until it draws again.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Handoff {
    pty: u32,
    title: String,
    /// The screen and scrollback, as xterm.js serializes them.
    screen: String,
    /// The size the screen was saved at, to restore it at before fitting the new window.
    cols: u16,
    rows: u16,
    /// Its own text size, in pixels away from the editor's.
    font_offset: i32,
}

struct Floating {
    /// The window it belongs to (and a terminal goes back to).
    parent: String,
    /// What it shows: a terminal (by its shell), or a git dialog.
    pty: Option<u32>,
    /// A terminal's, taken by the window once it has loaded.
    handoff: Option<Handoff>,
}

/// The floating windows, by label.
#[derive(Default)]
pub struct FloatingWindows(Mutex<HashMap<String, Floating>>);

pub fn is_floating(label: &str) -> bool {
    label.starts_with(TERMINAL) || label.starts_with(GIT)
}

pub fn is_terminal(label: &str) -> bool {
    label.starts_with(TERMINAL)
}

fn parent_label(app: &AppHandle, label: &str) -> Option<String> {
    Some(app.state::<FloatingWindows>().0.lock().ok()?.get(label)?.parent.clone())
}

/// The window a floating window belongs to, if `label` is one.
pub fn parent(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    app.get_webview_window(&parent_label(app, label)?)
}

/// The app window whose folder `label` works on: its own, or its parent's.
pub fn owner<R: tauri::Runtime>(app: &AppHandle<R>, label: &str) -> String {
    let parent = is_floating(label)
        .then(|| app.state::<FloatingWindows>().0.lock().ok()?.get(label).map(|f| f.parent.clone()))
        .flatten();
    parent.unwrap_or_else(|| label.to_string())
}

/// A window closed: forgets it if it was a floating one, and closes the
/// floating windows that belong to it (which ends their shells).
pub fn window_destroyed(app: &AppHandle, label: &str) {
    let orphans: Vec<String> = match app.state::<FloatingWindows>().0.lock() {
        Ok(mut floating) => {
            floating.remove(label);
            floating.iter().filter(|(_, f)| f.parent == label).map(|(l, _)| l.clone()).collect()
        }
        Err(_) => return,
    };
    // Outside the lock: destroying a window comes back here.
    for orphan in orphans {
        if let Some(window) = app.get_webview_window(&orphan) {
            let _ = window.destroy();
        }
    }
}

/// Size of a new floating terminal, and how far in from its window's bottom-left corner it opens.
const SIZE: (f64, f64) = (720.0, 420.0);
const INSET: f64 = 48.0;

/// Where a window is on the desktop, in logical pixels.
#[derive(Deserialize, Clone, Copy)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// The title of a floating window of `parent`: `name`, then its folder's.
fn title(app: &AppHandle, parent: &WebviewWindow, name: &str) -> Result<String, String> {
    let folder = app
        .state::<crate::Workspaces>()
        .root(parent.label())?
        .and_then(|root| root.file_name().map(|n| n.to_string_lossy().into_owned()));
    Ok(match folder {
        Some(folder) => format!("{name} — {folder}"),
        None => name.to_string(),
    })
}

/// Opens a window like the app's (title bar, permissions) at `bounds`, or at
/// `size` with `place` turning the parent's bounds into its position.
fn build(
    app: &AppHandle,
    parent: &WebviewWindow,
    label: &str,
    title: String,
    bounds: Result<Bounds, (f64, f64)>,
    min: (f64, f64),
    place: impl FnOnce(Bounds, (f64, f64)) -> (f64, f64),
) -> tauri::Result<()> {
    let Some(mut config) = app.config().app.windows.first().cloned() else {
        return Err(tauri::Error::WindowNotFound);
    };
    config.label = label.to_string();
    config.title = title;
    (config.min_width, config.min_height) = (Some(min.0), Some(min.1));
    let (x, y, width, height) = match bounds {
        Ok(b) => (b.x, b.y, b.width.max(min.0), b.height.max(min.1)),
        Err(size) => {
            let scale = parent.scale_factor()?;
            let at = parent.outer_position()?.to_logical::<f64>(scale);
            let outer = parent.outer_size()?.to_logical::<f64>(scale);
            let (x, y) = place(Bounds { x: at.x, y: at.y, width: outer.width, height: outer.height }, size);
            (x, y, size.0, size.1)
        }
    };
    (config.width, config.height) = (width, height);
    crate::background::window(app, config)?.position(x, y).build()?;
    Ok(())
}

/// Moves a terminal the calling window has detached into a new window of its own.
#[tauri::command]
pub async fn open_terminal_window(app: AppHandle, window: WebviewWindow, handoff: Handoff) -> Result<(), String> {
    static NEXT: AtomicUsize = AtomicUsize::new(1);
    let label = format!("{TERMINAL}{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let pty = handoff.pty;
    let title = title(&app, &window, &handoff.title)?;

    let terminals = app.state::<Terminals>();
    terminals.hand_over(pty, window.label(), &label)?;
    app.state::<FloatingWindows>()
        .0
        .lock()
        .map_err(crate::err)?
        .insert(label.clone(), Floating { parent: window.label().to_string(), pty: Some(pty), handoff: Some(handoff) });

    // In from the bottom-left corner of its window, where the panel is.
    let built = build(&app, &window, &label, title, Err(SIZE), (360.0, 180.0), |p, size| {
        (p.x + INSET, p.y + (p.height - size.1 - INSET).max(INSET))
    });
    if let Err(e) = built {
        // The terminal stays where it was.
        if let Ok(mut floating) = app.state::<FloatingWindows>().0.lock() {
            floating.remove(&label);
        }
        terminals.hand_over(pty, &label, window.label())?;
        return Err(e.to_string());
    }
    Ok(())
}

/// The terminal a floating window was opened for, once: a reload finds none and closes it.
#[tauri::command]
pub fn terminal_window(window: WebviewWindow, floating: tauri::State<FloatingWindows>) -> Option<Handoff> {
    floating.0.lock().ok()?.get_mut(window.label())?.handoff.take()
}

/// Puts a floating window's terminal, which it has detached, back in its
/// window's panel, and closes the floating window.
#[tauri::command]
pub async fn dock_terminal(app: AppHandle, window: WebviewWindow, handoff: Handoff) -> Result<(), String> {
    let parent = {
        let floating = app.state::<FloatingWindows>();
        let floating = floating.0.lock().map_err(crate::err)?;
        match floating.get(window.label()) {
            Some(f) if f.pty == Some(handoff.pty) => f.parent.clone(),
            _ => return Err("That terminal isn't in this window".to_string()),
        }
    };
    app.state::<Terminals>().hand_over(handoff.pty, window.label(), &parent)?;
    app.emit_to(parent.as_str(), "terminal-docked", handoff).map_err(crate::err)?;
    if let Some(parent) = app.get_webview_window(&parent) {
        let _ = parent.set_focus();
    }
    window.destroy().map_err(crate::err)
}

/// A width and height, in logical pixels.
type Size = (f64, f64);

/// A git dialog that opens in a window of its own: its name, its size and its smallest.
fn git_dialog(dialog: &str) -> Option<(&'static str, Size, Size)> {
    match dialog {
        "commit" => Some(("Commit Changes", (1180.0, 820.0), (720.0, 520.0))),
        "push" => Some(("Push Commits", (900.0, 560.0), (560.0, 340.0))),
        _ => None,
    }
}

/// Opens one of the calling window's git dialogs (`commit`, `push`) in a
/// window of its own, at `bounds` (where it was last), or brings it to the
/// front when it's open. Returns its label, for the window to send it the git state.
#[tauri::command]
pub async fn open_git_window(
    app: AppHandle,
    window: WebviewWindow,
    dialog: String,
    bounds: Option<Bounds>,
) -> Result<String, String> {
    static NEXT: AtomicUsize = AtomicUsize::new(1);
    let (name, size, min) = git_dialog(&dialog).ok_or_else(|| format!("No such dialog: {dialog}"))?;
    let prefix = format!("{GIT}{dialog}-");
    let open = app
        .state::<FloatingWindows>()
        .0
        .lock()
        .map_err(crate::err)?
        .iter()
        .find(|(label, f)| label.starts_with(&prefix) && f.parent == window.label())
        .map(|(label, _)| label.clone());
    if let Some(label) = open.and_then(|l| app.get_webview_window(&l)) {
        let _ = label.unminimize();
        label.set_focus().map_err(crate::err)?;
        return Ok(label.label().to_string());
    }

    let label = format!("{prefix}{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let title = title(&app, &window, name)?;
    app.state::<FloatingWindows>()
        .0
        .lock()
        .map_err(crate::err)?
        .insert(label.clone(), Floating { parent: window.label().to_string(), pty: None, handoff: None });
    // Centred on its window, as the dialog was.
    let built = build(&app, &window, &label, title, bounds.ok_or(size), min, |p, size| {
        let (width, height) = (size.0.min(p.width), size.1.min(p.height));
        (p.x + (p.width - width) / 2.0, p.y + (p.height - height) / 2.0)
    });
    if let Err(e) = built {
        if let Ok(mut floating) = app.state::<FloatingWindows>().0.lock() {
            floating.remove(&label);
        }
        return Err(e.to_string());
    }
    Ok(label)
}

/// The label of the window a floating window belongs to.
#[tauri::command]
pub fn window_parent(app: AppHandle, window: WebviewWindow) -> Option<String> {
    parent_label(&app, window.label())
}
