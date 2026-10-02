// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { wordDocument, type WordOptions } from "./exportWord";
import { createAnchor, locate, type Thread } from "./comments";

/** A thread on `text` (its first occurrence in `source`), with replies. */
function thread(source: string, text: string, bodies: string[], resolved = false): WordOptions["threads"][number] {
  const from = source.indexOf(text);
  const anchor = createAnchor(source, { from, to: from + text.length });
  const t: Thread = {
    id: `t-${text}`,
    anchor,
    resolved,
    files: [],
    events: [],
    comments: bodies.map((body, i) => ({
      id: `c${i}`,
      author: { name: i ? "Ada Lovelace" : "Grace Hopper", email: "" },
      at: "2026-10-01T10:00:00.000Z",
      body,
    })),
  };
  return { thread: t, range: locate(source, anchor) };
}

/** The parts of the .docx made for `source`, as XML text. */
async function exportParts(source: string, threads: WordOptions["threads"] = []) {
  const blob = await wordDocument({
    source,
    filePath: "/docs/note.md",
    root: "/docs",
    title: "note",
    showFrontmatter: true,
    // Like a file that isn't there.
    assetUrl: () => "mido-missing:image",
    variables: {},
    mermaid: { dark: false, variables: {} },
    threads,
  });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const read = async (name: string) => (await zip.file(name)?.async("string")) ?? "";
  return {
    document: await read("word/document.xml"),
    comments: await read("word/comments.xml"),
    commentsExtended: await read("word/commentsExtended.xml"),
    footnotes: await read("word/footnotes.xml"),
    numbering: await read("word/numbering.xml"),
    contentTypes: await read("[Content_Types].xml"),
    rels: await read("word/_rels/document.xml.rels"),
  };
}

/** The document's text with comment marks as ⟦id and id⟧, to check where they landed. */
function markedText(document: string): string {
  const out: string[] = [];
  for (const m of document.matchAll(
    /<w:commentRangeStart w:id="(\d+)"\/>|<w:commentRangeEnd w:id="(\d+)"\/>|<w:t[^>]*>([^<]*)<\/w:t>|<\/w:p>/g,
  )) {
    if (m[1] !== undefined) out.push(`⟦${m[1]}`);
    else if (m[2] !== undefined) out.push(`${m[2]}⟧`);
    else if (m[3] !== undefined) out.push(m[3]);
    else out.push("\n");
  }
  return out.join("").trim();
}

describe("wordDocument", () => {
  it("uses Word's heading styles and run formatting", async () => {
    const { document } = await exportParts("# Title\n\nSome **bold**, *italic* and ~~gone~~ text.");
    expect(document).toContain('<w:pStyle w:val="Heading1"/>');
    expect(document).toMatch(/<w:b\/>[\s\S]*?<w:t[^>]*>bold<\/w:t>/);
    expect(document).toMatch(/<w:i\/>[\s\S]*?<w:t[^>]*>italic<\/w:t>/);
    expect(document).toMatch(/<w:strike\/>[\s\S]*?<w:t[^>]*>gone<\/w:t>/);
  });

  it("puts comments on the commented words, with replies threaded under them", async () => {
    const source = "# Notes\n\nHello brave new world.\n";
    const { document, comments, commentsExtended } = await exportParts(source, [
      thread(source, "brave new", ["Too much?", "Keep it"]),
    ]);
    expect(markedText(document)).toBe("Notes\nHello ⟦0⟦1brave new0⟧1⟧ world.");
    expect(comments).toContain("Too much?");
    expect(comments).toContain('w:author="Grace Hopper"');
    expect(comments).toContain('w:initials="AL"');
    expect(commentsExtended).toContain("w15:paraIdParent");
  });

  it("keeps comments across formatting and paragraphs", async () => {
    const source = "One **two** three\n\nfour five\n";
    const { document } = await exportParts(source, [thread(source, "two** three\n\nfour", ["Spans"])]);
    expect(markedText(document)).toBe("One ⟦0two three\nfour0⟧ five");
  });

  it("marks resolved threads as done, with replies or without", async () => {
    const source = "Done here. And there.";
    const single = await exportParts(source, [thread(source, "Done", ["Fixed"], true), thread(source, "there", ["Open"])]);
    expect(single.comments).toContain('w14:paraId="00000001"');
    expect(single.commentsExtended).toContain('w15:paraId="00000001" w15:done="1"');
    expect(single.commentsExtended).toContain('w15:paraId="00000002" w15:done="0"');
    expect(single.contentTypes).toContain("/word/commentsExtended.xml");
    expect(single.rels).toContain('Target="commentsExtended.xml"');
    const replies = await exportParts(source, [thread(source, "Done", ["Fixed", "Yes"], true)]);
    expect(replies.commentsExtended).toContain('w15:done="1"');
  });

  it("keeps comments whose text is gone, at the top", async () => {
    const source = "Text.";
    const gone = thread(source, "Text", ["Old"]);
    const { document, comments } = await exportParts(source, [{ ...gone, range: null }]);
    expect(markedText(document)).toBe("⟦00⟧Text.");
    expect(comments).toContain("Old");
  });

  it("makes footnotes Word footnotes", async () => {
    const { document, footnotes } = await exportParts("Claim[^a].\n\n[^a]: The source.\n");
    expect(document).toContain('<w:footnoteReference w:id="1"/>');
    expect(footnotes).toContain("The source.");
  });

  it("writes formulas as Word equations", async () => {
    const { document } = await exportParts("Inline $x^2$ and\n\n$$\n\\frac{a}{\\sqrt{b}}\n$$\n");
    expect(document).toContain("<m:oMath>");
    expect(document).toContain("<m:sSup>");
    expect(document).toContain("<m:f>");
    expect(document).toContain("<m:rad>");
  });

  it("numbers lists, restarting each ordered one, and boxes tasks", async () => {
    const { document, numbering } = await exportParts("1. a\n2. b\n\npara\n\n3. c\n\n- [x] done\n- [ ] todo\n");
    expect(numbering).toContain('w:val="decimal"');
    expect(numbering).toContain('<w:start w:val="3"/>');
    expect(markedText(document)).toContain("☑ done");
    expect(markedText(document)).toContain("☐ todo");
  });

  it("shows images it can't load as their alt text", async () => {
    const { document } = await exportParts("![A cat](missing.png)");
    expect(markedText(document)).toBe("[A cat]");
  });

  it("writes tables with a header row", async () => {
    const { document } = await exportParts("| A | B |\n|---|--:|\n| 1 | 2 |\n");
    expect(document).toContain("<w:tblHeader/>");
    expect(document).toContain('<w:jc w:val="right"/>');
  });
});
