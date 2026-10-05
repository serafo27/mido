//! The main window's size and place, kept on disk so the next launch (or the
//! relaunch after an update) opens it where it was left. It's read before the
//! window is built, so the window opens there rather than jumping to it.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::utils::config::WindowConfig;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// How long a window has to stay still before its bounds are written: a drag
/// moves it many times a second.
const SETTLE: Duration = Duration::from_millis(400);

/// How much of a window's top edge (where it's dragged from) has to be on a
/// screen for it to open there, in logical pixels.
const GRIP: (f64, f64) = (80.0, 32.0);

/// A rectangle on the desktop, in logical pixels.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Where the window was, and whether it was maximized. `bounds` are the
/// unmaximized ones, so un-maximizing goes back to them.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
struct Saved {
    bounds: Rect,
    maximized: bool,
}

pub struct WindowState {
    file: PathBuf,
    saved: Mutex<Option<Saved>>,
    last_change: Mutex<Instant>,
    scheduled: AtomicBool,
}

impl WindowState {
    pub fn load(file: PathBuf) -> Self {
        let saved = std::fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok());
        WindowState { file, saved: Mutex::new(saved), last_change: Mutex::new(Instant::now()), scheduled: AtomicBool::new(false) }
    }

    fn saved(&self) -> Option<Saved> {
        self.saved.lock().ok().and_then(|s| *s)
    }

    /// Writes `window`'s bounds, unless it's minimized or full screen (then
    /// the ones it had before stay). A maximized window keeps its earlier bounds.
    fn save<R: Runtime>(&self, window: &WebviewWindow<R>) {
        let Some(saved) = self.current(window) else { return };
        let Ok(mut current) = self.saved.lock() else { return };
        if *current == Some(saved) {
            return;
        }
        *current = Some(saved);
        if let Ok(json) = serde_json::to_string(&saved) {
            if let Some(dir) = self.file.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(&self.file, json);
        }
    }

    fn current<R: Runtime>(&self, window: &WebviewWindow<R>) -> Option<Saved> {
        if window.is_minimized().ok()? || window.is_fullscreen().ok()? {
            return None;
        }
        if window.is_maximized().ok()? {
            let bounds = self.saved()?.bounds;
            return Some(Saved { bounds, maximized: true });
        }
        let scale = window.scale_factor().ok()?;
        let at = window.outer_position().ok()?.to_logical::<f64>(scale);
        let size = window.inner_size().ok()?.to_logical::<f64>(scale);
        Some(Saved { bounds: Rect { x: at.x, y: at.y, width: size.width, height: size.height }, maximized: false })
    }
}

/// Gives the main window's `config` the size and place it was left at, if
/// they still fit on a screen.
pub fn restore<R: Runtime>(app: &AppHandle<R>, config: &mut WindowConfig) {
    let Some(saved) = app.state::<WindowState>().saved() else { return };
    let screens: Vec<Rect> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let scale = m.scale_factor();
            let at = m.position().to_logical::<f64>(scale);
            let size = m.size().to_logical::<f64>(scale);
            Rect { x: at.x, y: at.y, width: size.width, height: size.height }
        })
        .collect();
    let min = (config.min_width.unwrap_or(0.0), config.min_height.unwrap_or(0.0));
    let Some(bounds) = placeable(saved.bounds, min, &screens) else { return };
    (config.x, config.y) = (Some(bounds.x), Some(bounds.y));
    (config.width, config.height) = (bounds.width, bounds.height);
    config.center = false;
    config.maximized = saved.maximized;
}

/// `bounds`, at least `min` in size, if their top edge is on one of `screens`.
fn placeable(bounds: Rect, min: (f64, f64), screens: &[Rect]) -> Option<Rect> {
    let bounds = Rect { width: bounds.width.max(min.0), height: bounds.height.max(min.1), ..bounds };
    let grip = |s: &Rect| {
        let width = (bounds.x + bounds.width).min(s.x + s.width) - bounds.x.max(s.x);
        let height = (bounds.y + GRIP.1).min(s.y + s.height) - bounds.y.max(s.y);
        width >= GRIP.0 && height >= GRIP.1
    };
    screens.iter().any(grip).then_some(bounds)
}

/// The main window moved or changed size: writes its bounds once it settles.
pub fn changed<R: Runtime>(window: &WebviewWindow<R>) {
    let state = window.state::<WindowState>();
    if let Ok(mut last) = state.last_change.lock() {
        *last = Instant::now();
    }
    if state.scheduled.swap(true, Ordering::AcqRel) {
        return;
    }
    let window = window.clone();
    std::thread::spawn(move || {
        let state = window.state::<WindowState>();
        loop {
            std::thread::sleep(SETTLE);
            if state.last_change.lock().map(|l| l.elapsed() >= SETTLE).unwrap_or(true) {
                break;
            }
        }
        // Before saving: a change from now on schedules another save.
        state.scheduled.store(false, Ordering::Release);
        state.save(&window);
    });
}

/// Writes the main window's bounds now: it's closing, or the app is quitting.
pub fn save_now<R: Runtime>(window: &WebviewWindow<R>) {
    window.state::<WindowState>().save(window);
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect { x: 0.0, y: 0.0, width: 1512.0, height: 982.0 };

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect { x, y, width, height }
    }

    #[test]
    fn remembers_the_bounds_for_the_next_launch() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("window-state.json");
        assert_eq!(WindowState::load(file.clone()).saved(), None);
        let saved = Saved { bounds: rect(40.0, 60.0, 1000.0, 700.0), maximized: true };
        std::fs::write(&file, serde_json::to_string(&saved).unwrap()).unwrap();
        assert_eq!(WindowState::load(file.clone()).saved(), Some(saved));
        std::fs::write(&file, "nonsense").unwrap();
        assert_eq!(WindowState::load(file).saved(), None);
    }

    #[test]
    fn opens_where_it_was_on_a_screen_still_there() {
        let bounds = rect(100.0, 50.0, 1000.0, 700.0);
        assert_eq!(placeable(bounds, (720.0, 480.0), &[SCREEN]), Some(bounds));
        // On a second screen to the left.
        let left = rect(-1920.0, 0.0, 1920.0, 1080.0);
        let there = rect(-1500.0, 100.0, 1000.0, 700.0);
        assert_eq!(placeable(there, (720.0, 480.0), &[SCREEN, left]), Some(there));
    }

    #[test]
    fn not_where_no_screen_is_any_more() {
        // Left on an external screen that's been unplugged.
        assert_eq!(placeable(rect(-1500.0, 100.0, 1000.0, 700.0), (0.0, 0.0), &[SCREEN]), None);
        // Only a sliver of the top edge on screen.
        assert_eq!(placeable(rect(1480.0, 100.0, 1000.0, 700.0), (0.0, 0.0), &[SCREEN]), None);
        // Top edge below the screen's bottom.
        assert_eq!(placeable(rect(100.0, 970.0, 1000.0, 700.0), (0.0, 0.0), &[SCREEN]), None);
        assert_eq!(placeable(rect(100.0, 50.0, 1000.0, 700.0), (0.0, 0.0), &[]), None);
    }

    #[test]
    fn never_smaller_than_the_window_allows() {
        let placed = placeable(rect(100.0, 50.0, 300.0, 200.0), (720.0, 480.0), &[SCREEN]).unwrap();
        assert_eq!((placed.width, placed.height), (720.0, 480.0));
    }
}
