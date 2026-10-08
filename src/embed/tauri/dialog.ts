// Embedded stand-in for @tauri-apps/plugin-dialog: the host shows native dialogs.
import { request } from "../bridge";

/** The host decides which folder is open: nothing to pick. */
export async function open(): Promise<string | null> {
  return null;
}

export function ask(message: string, options?: Record<string, unknown>): Promise<boolean> {
  return request<boolean>("dialog_ask", { message, options });
}

export function confirm(message: string, options?: Record<string, unknown>): Promise<boolean> {
  return request<boolean>("dialog_ask", { message, options });
}

export async function message(text: string, options?: Record<string, unknown>): Promise<string> {
  await request("dialog_message", { message: text, options });
  return "Ok";
}
