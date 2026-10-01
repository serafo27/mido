// Web stand-in for @tauri-apps/plugin-opener.
import { requireDesktop } from "../../lib/platform";

export async function openUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function revealItemInDir() {
  requireDesktop("Showing files in the Finder");
}
