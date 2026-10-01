import { invoke } from "@tauri-apps/api/core";

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[] | null;
}

export const api = {
  readTree: (root: string) => invoke<FileNode[]>("read_tree", { root }),
  readFile: (path: string) => invoke<string>("read_file", { path }),
  /**
   * Writes `content` unless the file on disk no longer matches `expected` (what
   * Mido last read or wrote), in which case nothing is written. `null` overwrites.
   */
  writeFile: (path: string, content: string, expected: string | null) =>
    invoke<"written" | "conflict">("write_file", { path, content, expected }),
  createFile: (path: string) => invoke<void>("create_file", { path }),
  createDir: (path: string) => invoke<void>("create_dir", { path }),
  renamePath: (from: string, to: string) => invoke<void>("rename_path", { from, to }),
  trashPath: (path: string) => invoke<void>("trash_path", { path }),
  watchFolder: (root: string) => invoke<void>("watch_folder", { root }),
};
