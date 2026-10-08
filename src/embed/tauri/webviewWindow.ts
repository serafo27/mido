// Embedded stand-in for @tauri-apps/api/webviewWindow: one window.
import { getCurrentWindow } from "./window";

export async function getAllWebviewWindows() {
  return [getCurrentWindow()];
}
