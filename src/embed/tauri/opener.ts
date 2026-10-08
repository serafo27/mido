// Embedded stand-in for @tauri-apps/plugin-opener: the host opens links and reveals files.
import { request } from "../bridge";

export async function openUrl(url: string) {
  await request("open_url", { url });
}

export async function revealItemInDir(path: string) {
  await request("reveal_item", { path });
}
