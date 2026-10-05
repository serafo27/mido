//! Floating terminals: a terminal moved out of a window's panel into a window
//! of its own, to place anywhere on the desktop. It still belongs to the window
//! it came from (its folder's): closing it puts the terminal back in that
//! window's panel, and closing that window closes it too.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder};

use crate::terminal::Terminals;

const PREFIX: &str = "terminal-";

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
    /// The window it came from, and goes back to.
    parent: String,
    pty: u32,
    /// Taken by the window once it has loaded.
    handoff: Option<Handoff>,
}

/// The floating terminal windows, by label.
#[derive(Default)]
pub struct FloatingTerminals(Mutex<HashMap<String, Floating>>);

pub fn is_floating(label: &str) -> bool {
    label.starts_with(PREFIX)
}

/// The window a floating terminal came from, if `label` is one.
pub fn parent(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    let parent = app.state::<FloatingTerminals>().0.lock().ok()?.get(label)?.parent.clone();
    app.get_webview_window(&parent)
}

/// A window closed: forgets it if it was a floating terminal, and closes the
/// floating terminals that came from it (which ends their shells).
pub fn window_destroyed(app: &AppHandle, label: &str) {
    let orphans: Vec<String> = match app.state::<FloatingTerminals>().0.lock() {
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

/// Moves a terminal the calling window has detached into a new window of its own.
#[tauri::command]
pub async fn open_terminal_window(app: AppHandle, window: WebviewWindow, handoff: Handoff) -> Result<(), String> {
    static NEXT: AtomicUsize = AtomicUsize::new(1);
    let label = format!("{PREFIX}{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let pty = handoff.pty;
    let folder = app
        .state::<crate::Workspaces>()
        .root(window.label())?
        .and_then(|root| root.file_name().map(|n| n.to_string_lossy().into_owned()));
    let title = match folder {
        Some(folder) => format!("{} — {folder}", handoff.title),
        None => handoff.title.clone(),
    };

    let terminals = app.state::<Terminals>();
    terminals.hand_over(pty, window.label(), &label)?;
    app.state::<FloatingTerminals>()
        .0
        .lock()
        .map_err(crate::err)?
        .insert(label.clone(), Floating { parent: window.label().to_string(), pty, handoff: Some(handoff) });

    let built = (|| -> tauri::Result<()> {
        // Like the app's windows (title bar, permissions), smaller.
        let Some(mut config) = app.config().app.windows.first().cloned() else {
            return Err(tauri::Error::WindowNotFound);
        };
        config.label = label.clone();
        config.title = title;
        (config.width, config.height) = SIZE;
        (config.min_width, config.min_height) = (Some(360.0), Some(180.0));
        let scale = window.scale_factor()?;
        let at = window.outer_position()?.to_logical::<f64>(scale);
        let size = window.outer_size()?.to_logical::<f64>(scale);
        WebviewWindowBuilder::from_config(&app, &config)?
            .position(at.x + INSET, at.y + (size.height - SIZE.1 - INSET).max(INSET))
            .build()?;
        Ok(())
    })();
    if let Err(e) = built {
        // The terminal stays where it was.
        if let Ok(mut floating) = app.state::<FloatingTerminals>().0.lock() {
            floating.remove(&label);
        }
        terminals.hand_over(pty, &label, window.label())?;
        return Err(e.to_string());
    }
    Ok(())
}

/// The terminal a floating window was opened for, once: a reload finds none and closes it.
#[tauri::command]
pub fn terminal_window(window: WebviewWindow, floating: tauri::State<FloatingTerminals>) -> Option<Handoff> {
    floating.0.lock().ok()?.get_mut(window.label())?.handoff.take()
}

/// Puts a floating window's terminal, which it has detached, back in its
/// window's panel, and closes the floating window.
#[tauri::command]
pub async fn dock_terminal(app: AppHandle, window: WebviewWindow, handoff: Handoff) -> Result<(), String> {
    let parent = {
        let floating = app.state::<FloatingTerminals>();
        let floating = floating.0.lock().map_err(crate::err)?;
        match floating.get(window.label()) {
            Some(f) if f.pty == handoff.pty => f.parent.clone(),
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
