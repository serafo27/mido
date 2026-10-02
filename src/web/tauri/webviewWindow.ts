// Web stand-in for @tauri-apps/api/webviewWindow: the browser tab is the only window.
import { getCurrentWindow } from "./window";

export async function getAllWebviewWindows() {
  return [getCurrentWindow()];
}
