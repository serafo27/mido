// Small synchronous path helpers. Tauri's path API is async, which is awkward
// inside render functions (e.g. resolving image sources in the preview).

const lastSep = (p: string) => Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));

export const sepOf = (p: string) => (p.includes("\\") && !p.includes("/") ? "\\" : "/");

export function basename(p: string): string {
  return p.slice(lastSep(p) + 1);
}

export function dirname(p: string): string {
  const i = lastSep(p);
  return i <= 0 ? p.slice(0, i + 1) : p.slice(0, i);
}

export function join(dir: string, name: string): string {
  const sep = sepOf(dir);
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

export function isAbsolute(p: string): boolean {
  return p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p);
}

/** Resolves `rel` against the directory `base`, normalising `.` and `..`. */
export function resolve(base: string, rel: string): string {
  if (isAbsolute(rel)) return rel;
  const sep = sepOf(base);
  const parts = base.split(/[\\/]/);
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 1) parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join(sep);
}

export function relative(root: string, p: string): string {
  return p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]/, "") : p;
}

export function isInside(parent: string, p: string): boolean {
  return p === parent || p.startsWith(parent + "/") || p.startsWith(parent + "\\");
}

export const isMarkdown = (p: string) => /\.(md|markdown|mdown|mkd|mdx)$/i.test(p);

/**
 * Decodes a link's percent-escapes. One that isn't valid (`100%.png` in raw
 * HTML, which the Markdown parser doesn't escape) is kept as written.
 */
export function decodeLink(href: string, decode: (s: string) => string = decodeURI): string {
  try {
    return decode(href);
  } catch {
    return href;
  }
}
