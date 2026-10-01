// Web stand-in for @tauri-apps/api/window: the browser tab is the window.

// The page's own title (see vite.web.config.ts), shown while no file is open
// in place of the app's bare "Mido", so search engines index a descriptive one.
const pageTitle = document.title;

export function getCurrentWindow() {
  return {
    async setTitle(title: string) {
      document.title = title === "Mido" ? pageTitle : title;
    },
    // Nothing is ever unsaved in the web version.
    async onCloseRequested() {
      return () => {};
    },
  };
}
