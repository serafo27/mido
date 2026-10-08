// Embedded stand-in for @tauri-apps/api/core (aliased in vite.embed.config.ts).
import { registerChannel, request } from "../bridge";
// Every embedded page follows the host's theme.
import "../theme";

export function invoke<T>(
  command: string,
  args: Record<string, unknown> | Uint8Array = {},
  options?: { headers?: Record<string, string> },
): Promise<T> {
  return request<T>(command, args, options);
}

/** Files are served by the host, limited to the open folder. */
export function convertFileSrc(path: string): string {
  return `${location.origin}/__file__${encodeURI(path)}`;
}

/** A stream from the host (a terminal's output, its exit), relayed over the bridge. */
export class Channel<T> {
  onmessage: (message: T) => void = () => {};
  readonly __midoChannel = registerChannel(this as Channel<unknown>);
}
