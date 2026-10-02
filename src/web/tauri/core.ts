// Web stand-in for @tauri-apps/api/core (aliased in vite.web.config.ts).
import { assetUrl, commands, installPageHandlers, type InvokeOptions } from "../backend";

installPageHandlers();

export async function invoke<T>(
  command: string,
  args: Record<string, unknown> | Uint8Array = {},
  options?: InvokeOptions,
): Promise<T> {
  const run = commands[command];
  if (!run) throw new Error(`${command} isn't available in the web version`);
  return (await run(args as Record<string, unknown>, options)) as T;
}

export function convertFileSrc(path: string): string {
  return assetUrl(path);
}

/** The web version has no backend to stream from: a channel that never hears anything. */
export class Channel<T> {
  onmessage: (message: T) => void = () => {};
}
