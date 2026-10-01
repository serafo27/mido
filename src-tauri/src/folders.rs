//! The folders the user has let Mido open: picked in the native dialog, opened
//! from the Finder, the Dock or the command line, or confirmed in a native
//! prompt. `open_folder` only opens these without asking, so the webview alone
//! can never widen what the file commands can reach.

use std::collections::VecDeque;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Older grants are forgotten past this many; reopening one asks again.
const MAX_FOLDERS: usize = 100;

/// Most recently granted first.
#[derive(Debug, Default)]
pub struct Granted {
    folders: VecDeque<PathBuf>,
    file: Option<PathBuf>,
}

impl Granted {
    /// The grants saved in `file`; none if it's missing or unreadable.
    pub fn load(file: PathBuf) -> Self {
        let folders = fs::read_to_string(&file)
            .ok()
            .and_then(|text| serde_json::from_str::<Vec<PathBuf>>(&text).ok())
            .unwrap_or_default();
        Granted { folders: folders.into_iter().take(MAX_FOLDERS).collect(), file: Some(file) }
    }

    pub fn contains(&self, folder: &Path) -> bool {
        self.folders.iter().any(|f| f == folder)
    }

    /// Records `folder` and saves the list.
    pub fn grant(&mut self, folder: &Path) -> io::Result<()> {
        self.folders.retain(|f| f != folder);
        self.folders.push_front(folder.to_path_buf());
        self.folders.truncate(MAX_FOLDERS);
        let Some(file) = &self.file else {
            return Ok(());
        };
        if let Some(dir) = file.parent() {
            fs::create_dir_all(dir)?;
        }
        let json = serde_json::to_string_pretty(&self.folders).map_err(io::Error::other)?;
        fs::write(file, json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remembers_grants_across_loads() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sub/granted-folders.json");
        let mut granted = Granted::load(file.clone());
        assert!(!granted.contains(Path::new("/notes")));
        granted.grant(Path::new("/notes")).unwrap();
        granted.grant(Path::new("/work")).unwrap();

        let granted = Granted::load(file);
        assert!(granted.contains(Path::new("/notes")));
        assert!(granted.contains(Path::new("/work")));
        assert!(!granted.contains(Path::new("/notes/sub")));
        assert!(!granted.contains(Path::new("/")));
    }

    #[test]
    fn ignores_a_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("granted-folders.json");
        fs::write(&file, "not json").unwrap();
        assert!(!Granted::load(file).contains(Path::new("/notes")));
    }

    #[test]
    fn forgets_the_oldest_past_the_limit() {
        let mut granted = Granted::default();
        for n in 0..=MAX_FOLDERS {
            granted.grant(&PathBuf::from(format!("/f{n}"))).unwrap();
        }
        assert!(!granted.contains(Path::new("/f0")));
        assert!(granted.contains(Path::new("/f1")));
        // Granting again moves a folder back to the front.
        granted.grant(Path::new("/f1")).unwrap();
        granted.grant(Path::new("/new")).unwrap();
        assert!(granted.contains(Path::new("/f1")));
        assert!(!granted.contains(Path::new("/f2")));
    }
}
