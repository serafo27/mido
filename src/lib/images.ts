const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

export const isImageFile = (file: File) => file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name);

/** The image files carried by a paste or a drop. */
export function imageFiles(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter(isImageFile);
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The name to save an image under. Screenshots and other clipboard images
 * come with a generic name ("image.png"), so they get a dated one instead.
 */
export function assetName(name: string, now = new Date()): string {
  if (name && !/^image\.[a-z0-9]+$/i.test(name)) return name;
  const ext = /\.[a-z0-9]+$/i.exec(name)?.[0] ?? "";
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `image-${date}-${time}${ext}`;
}

/** A Markdown image for a saved asset (`assets/name.png`), its name as the alt text. */
export function imageMarkdown(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const alt = name.replace(/\.[^.]+$/, "").replace(/[[\]\\]/g, "");
  // Saved names have no spaces or brackets, but stay safe in a link anyway.
  const url = path.replace(/[ ()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `![${alt}](${url})`;
}
