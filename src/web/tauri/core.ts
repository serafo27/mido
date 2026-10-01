// Web stand-in for @tauri-apps/api/core (aliased in vite.web.config.ts).
import { assetUrl, commands, installPageHandlers } from "../backend";

installPageHandlers();

export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const run = commands[command];
  if (!run) throw new Error(`${command} isn't available in the web version`);
  return (await run(args)) as T;
}

export function convertFileSrc(path: string): string {
  return assetUrl(path);
}
