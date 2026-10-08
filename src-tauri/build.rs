fn main() {
    // The embeddable build (`pnpm build:embed`) ships as a resource; an empty folder
    // keeps `tauri dev` working before it has been built.
    let _ = std::fs::create_dir_all("../dist-embed");
    tauri_build::build()
}
