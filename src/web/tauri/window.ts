// Web stand-in for @tauri-apps/api/window: the browser tab is the window.
export function getCurrentWindow() {
  return {
    async setTitle(title: string) {
      document.title = title;
    },
    // Nothing is ever unsaved in the web version.
    async onCloseRequested() {
      return () => {};
    },
  };
}
