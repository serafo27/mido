//! Images pasted or dropped into the editor, saved next to the document.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Folder, next to the document, where its images go.
pub const ASSETS_DIR: &str = "assets";
/// Bigger files are refused: they're unlikely to be meant for a note.
pub const MAX_SIZE: usize = 25 * 1024 * 1024;

const IMAGE_TYPES: &[(&str, &str)] = &[
    ("image/png", "png"),
    ("image/jpeg", "jpg"),
    ("image/gif", "gif"),
    ("image/webp", "webp"),
    ("image/svg+xml", "svg"),
    ("image/avif", "avif"),
];

/// The file extension for an image, from its MIME type or else its name.
/// `None` for anything that isn't a supported image.
pub fn image_extension(mime: &str, name: &str) -> Option<&'static str> {
    if let Some((_, ext)) = IMAGE_TYPES.iter().find(|(m, _)| m.eq_ignore_ascii_case(mime)) {
        return Some(ext);
    }
    let ext = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    let ext = if ext == "jpeg" { "jpg".to_string() } else { ext };
    IMAGE_TYPES.iter().map(|(_, e)| *e).find(|e| *e == ext)
}

/// A file name stem safe to use in a Markdown link: letters, digits, `.`, `_`
/// and `-`, with runs of anything else turned into a single `-`.
pub fn sanitize_stem(name: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut out = String::new();
    for c in stem.chars() {
        if c.is_alphanumeric() || matches!(c, '.' | '_' | '-') {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_matches(|c| c == '-' || c == '.').to_string();
    if out.is_empty() { "image".to_string() } else { out }
}

/// `dir/stem.ext`, or `dir/stem-2.ext`, `dir/stem-3.ext`… if taken.
fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut path = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem}-{n}.{ext}"));
        n += 1;
    }
    path
}

/// Saves `bytes` in the `assets` folder next to `document`, never replacing
/// an existing file. Returns the path relative to the document's folder, with
/// `/` separators, ready for a Markdown link.
pub fn save(document: &Path, name: &str, mime: &str, bytes: &[u8]) -> io::Result<String> {
    let invalid = |msg: &str| io::Error::new(io::ErrorKind::InvalidInput, msg.to_string());
    let ext = image_extension(mime, name).ok_or_else(|| invalid("Only images can be added to a document"))?;
    if bytes.is_empty() {
        return Err(invalid("The image is empty"));
    }
    if bytes.len() > MAX_SIZE {
        return Err(invalid("Images over 25 MB can't be added"));
    }
    let doc_dir = document.parent().ok_or_else(|| invalid("The document has no folder"))?;
    let dir = doc_dir.join(ASSETS_DIR);
    fs::create_dir_all(&dir)?;
    let path = unique_path(&dir, &sanitize_stem(name), ext);
    // `create_new` so a file appearing in the meantime is never overwritten.
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&path)?;
    io::Write::write_all(&mut file, bytes)?;
    let file_name = path.file_name().unwrap().to_string_lossy();
    Ok(format!("{ASSETS_DIR}/{file_name}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_extension_from_the_type_then_the_name() {
        assert_eq!(image_extension("image/png", "whatever.bin"), Some("png"));
        assert_eq!(image_extension("IMAGE/JPEG", ""), Some("jpg"));
        assert_eq!(image_extension("", "Photo.JPEG"), Some("jpg"));
        assert_eq!(image_extension("application/octet-stream", "diagram.svg"), Some("svg"));
        assert_eq!(image_extension("text/plain", "notes.txt"), None);
        assert_eq!(image_extension("", "no-extension"), None);
        assert_eq!(image_extension("", "evil.html"), None);
    }

    #[test]
    fn sanitizes_names_for_links() {
        assert_eq!(sanitize_stem("Screen Shot 2026-10-01 at 10.00.png"), "Screen-Shot-2026-10-01-at-10.00");
        assert_eq!(sanitize_stem("città (copia).jpg"), "città-copia");
        assert_eq!(sanitize_stem("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_stem("  ***.png"), "image");
        assert_eq!(sanitize_stem(""), "image");
    }

    #[test]
    fn saves_next_to_the_document_without_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("sub/note.md");
        fs::create_dir_all(doc.parent().unwrap()).unwrap();

        assert_eq!(save(&doc, "shot.png", "image/png", b"one").unwrap(), "assets/shot.png");
        assert_eq!(save(&doc, "shot.png", "image/png", b"two").unwrap(), "assets/shot-2.png");
        assert_eq!(save(&doc, "shot.png", "image/png", b"three").unwrap(), "assets/shot-3.png");
        let assets = dir.path().join("sub/assets");
        assert_eq!(fs::read(assets.join("shot.png")).unwrap(), b"one");
        assert_eq!(fs::read(assets.join("shot-2.png")).unwrap(), b"two");
    }

    #[test]
    fn refuses_non_images_empty_and_oversized_files() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("note.md");
        assert!(save(&doc, "page.html", "text/html", b"<script>").is_err());
        assert!(save(&doc, "a.png", "image/png", b"").is_err());
        assert!(save(&doc, "a.png", "image/png", &vec![0; MAX_SIZE + 1]).is_err());
        assert!(!dir.path().join("assets/page.html").exists());
    }
}
