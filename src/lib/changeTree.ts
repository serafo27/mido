// The changed files of a commit or a status as a folder tree, the way VS Code
// shows them: folders first, then files, by name, and a folder that only
// holds another folder shown together with it ("docs/notes").

export interface ChangeFolder<T> {
  kind: "folder";
  /** The folders it stands for, joined: "docs" or "docs/notes". */
  name: string;
  /** Its full path in the repository, with "/". */
  path: string;
  children: ChangeNode<T>[];
}

export interface ChangeFile<T> {
  kind: "file";
  name: string;
  path: string;
  item: T;
}

export type ChangeNode<T> = ChangeFolder<T> | ChangeFile<T>;

/** By name, with hidden folders (`.mido`) after the rest: the documents come first. */
const byName = (a: { name: string }, b: { name: string }) =>
  Number(a.name.startsWith(".")) - Number(b.name.startsWith(".")) ||
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export function changeTree<T>(items: T[], pathOf: (item: T) => string): ChangeNode<T>[] {
  const root: ChangeFolder<T> = { kind: "folder", name: "", path: "", children: [] };
  for (const item of items) {
    const parts = pathOf(item).split("/");
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${part}` : part;
      let next = folder.children.find((c): c is ChangeFolder<T> => c.kind === "folder" && c.name === part);
      if (!next) {
        next = { kind: "folder", name: part, path, children: [] };
        folder.children.push(next);
      }
      folder = next;
    }
    folder.children.push({ kind: "file", name: parts.at(-1)!, path: pathOf(item), item });
  }
  return tidy(root).children;
}

function tidy<T>(folder: ChangeFolder<T>): ChangeFolder<T> {
  const folders = folder.children.filter((c): c is ChangeFolder<T> => c.kind === "folder").map((f) => {
    let compact = tidy(f);
    // Fold a chain of single folders into one row.
    while (compact.children.length === 1 && compact.children[0].kind === "folder") {
      const only = compact.children[0];
      compact = { ...only, name: `${compact.name}/${only.name}` };
    }
    return compact;
  });
  const files = folder.children.filter((c): c is ChangeFile<T> => c.kind === "file");
  return { ...folder, children: [...folders.sort(byName), ...files.sort(byName)] };
}

/** Every item in a node, however deep. */
export function itemsIn<T>(node: ChangeNode<T>): T[] {
  return node.kind === "file" ? [node.item] : node.children.flatMap(itemsIn);
}
