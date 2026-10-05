//! The windows' background: the theme's, so nothing white shows before the
//! page paints, or while a window grows and the page catches up. The webview
//! can't take a colour on macOS, so there it's see-through, over a window of
//! that colour. The colour is kept on disk for the next launch's first paint.

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::utils::config::{Color, WindowConfig};
use tauri::{AppHandle, Manager, Runtime, State, WebviewWindowBuilder};

/// Mido Dark's background: the first launch's theme.
const FIRST_LAUNCH: Color = Color(0x17, 0x18, 0x1a, 0xff);

pub struct Background {
    color: Mutex<Color>,
    file: PathBuf,
}

impl Background {
    pub fn load(file: PathBuf) -> Self {
        let color = std::fs::read_to_string(&file).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(FIRST_LAUNCH);
        Background { color: Mutex::new(color), file }
    }

    fn color(&self) -> Color {
        self.color.lock().map(|c| *c).unwrap_or(FIRST_LAUNCH)
    }
}

/// A window like the app's, as `config` describes it, on the theme's background.
pub fn window<'a, R: Runtime>(
    app: &'a AppHandle<R>,
    mut config: WindowConfig,
) -> tauri::Result<WebviewWindowBuilder<'a, R, AppHandle<R>>> {
    config.transparent = cfg!(target_os = "macos");
    let color = app.state::<Background>().color();
    Ok(WebviewWindowBuilder::from_config(app, &config)?.background_color(color))
}

/// Gives every window the theme's background, `color` as `#rrggbb`, and keeps it for the next launch.
#[tauri::command]
pub fn set_window_background<R: Runtime>(
    app: AppHandle<R>,
    background: State<'_, Background>,
    color: String,
) -> Result<(), String> {
    let parsed: Color = color.parse().map_err(|_| format!("Not a colour: {color}"))?;
    {
        let mut current = background.color.lock().map_err(crate::err)?;
        if *current == parsed {
            return Ok(());
        }
        *current = parsed;
    }
    for window in app.webview_windows().values() {
        let _ = window.set_background_color(Some(parsed));
    }
    if let Some(dir) = background.file.parent() {
        std::fs::create_dir_all(dir).map_err(crate::err)?;
    }
    std::fs::write(&background.file, color).map_err(crate::err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remembers_the_colour_for_the_next_launch() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("window-background");
        assert!(Background::load(file.clone()).color() == FIRST_LAUNCH);
        std::fs::write(&file, "#fbfaf7\n").unwrap();
        assert!(Background::load(file.clone()).color() == Color(0xfb, 0xfa, 0xf7, 0xff));
        std::fs::write(&file, "nonsense").unwrap();
        assert!(Background::load(file).color() == FIRST_LAUNCH);
    }
}
