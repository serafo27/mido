// Conflict markers git leaves in a file it couldn't merge:
//
//   <<<<<<< HEAD
//   our lines
//   ||||||| base          (only with merge.conflictStyle diff3 or zdiff3)
//   the original lines
//   =======
//   their lines
//   >>>>>>> other-branch

export interface Conflict {
  /** Offsets of the whole block in the text, markers included: [from, to). */
  from: number;
  to: number;
  /** What follows `<<<<<<<` and `>>>>>>>`: usually a branch name or a commit. */
  oursLabel: string;
  theirsLabel: string;
  ours: string;
  /** Null without a `|||||||` section. */
  base: string | null;
  theirs: string;
}

export type Resolution = "ours" | "theirs" | "both";

const marker = (line: string, char: string) => line.startsWith(char.repeat(7)) && line[7] !== char;
const label = (line: string) => line.slice(7).trim();

/** The conflicts in `text`, in order. A block missing its end marker isn't one. */
export function findConflicts(text: string): Conflict[] {
  const conflicts: Conflict[] = [];
  // Lines with their start offsets, keeping each line's newline.
  const lines: { text: string; at: number }[] = [];
  for (let at = 0; at < text.length; ) {
    const end = text.indexOf("\n", at);
    const next = end === -1 ? text.length : end + 1;
    lines.push({ text: text.slice(at, next), at });
    at = next;
  }

  for (let i = 0; i < lines.length; i++) {
    if (!marker(lines[i].text, "<")) continue;
    let base = -1;
    let middle = -1;
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].text;
      if (marker(line, "<")) break;
      if (middle === -1 && base === -1 && marker(line, "|")) base = j;
      else if (middle === -1 && marker(line, "=")) middle = j;
      else if (middle !== -1 && marker(line, ">")) {
        end = j;
        break;
      }
    }
    if (middle === -1 || end === -1) continue;
    const join = (from: number, to: number) => lines.slice(from, to).map((l) => l.text).join("");
    conflicts.push({
      from: lines[i].at,
      to: lines[end].at + lines[end].text.length,
      oursLabel: label(lines[i].text),
      theirsLabel: label(lines[end].text),
      ours: join(i + 1, base === -1 ? middle : base),
      base: base === -1 ? null : join(base + 1, middle),
      theirs: join(middle + 1, end),
    });
    i = end;
  }
  return conflicts;
}

/** What replaces a conflict when it's resolved one way. */
export function resolution(conflict: Conflict, choice: Resolution): string {
  if (choice === "ours") return conflict.ours;
  if (choice === "theirs") return conflict.theirs;
  const ours = conflict.ours;
  return ours && !ours.endsWith("\n") ? `${ours}\n${conflict.theirs}` : ours + conflict.theirs;
}

/** `text` with every conflict resolved the same way. */
export function resolveAll(text: string, choice: Resolution): string {
  let out = "";
  let at = 0;
  for (const conflict of findConflicts(text)) {
    out += text.slice(at, conflict.from) + resolution(conflict, choice);
    at = conflict.to;
  }
  return out + text.slice(at);
}
