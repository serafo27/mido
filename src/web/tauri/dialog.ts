// Web stand-in for @tauri-apps/plugin-dialog.
import { pickFiles, pickFolder } from "../backend";

/** A folder picker resolves to the folder's root; a file picker opens the files itself. */
export async function open(options: { directory?: boolean } = {}): Promise<string | null> {
  if (options.directory) return pickFolder();
  await pickFiles();
  return null;
}

export async function ask(message: string): Promise<boolean> {
  return window.confirm(message);
}

export async function message(text: string): Promise<string> {
  window.alert(text);
  return "Ok";
}
