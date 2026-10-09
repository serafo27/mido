import { describe, expect, it } from "vitest";
import {
  composeMessage,
  decide,
  describeTool,
  documentsToShare,
  EMPTY_CHAT,
  lineDiff,
  noteFor,
  reduce,
  turns,
  type Chat,
  type ToolUse,
} from "./ai";
// What Claude Code printed for "Read a.md and reply in 5 words", trimmed.
import stream from "./fixtures/claude-stream.jsonl?raw";

const asking: Chat = { ...EMPTY_CHAT, busy: true, items: [{ kind: "user", text: "Read a.md" }] };
const fold = (chat: Chat, lines: string[]) => lines.reduce(reduce, chat);
const event = (e: object) => JSON.stringify(e);

describe("reduce", () => {
  it("folds a streamed answer into the file it read and the text", () => {
    const chat = fold(asking, stream.trim().split("\n"));
    expect(chat.busy).toBe(false);
    expect(chat.session).toBe("7858e9da-4f5d-49be-b27d-ca8a412678c0");
    expect(chat.items.map((i) => i.kind)).toEqual(["user", "tool", "text"]);
    const tool = chat.items[1] as ToolUse;
    expect(tool).toMatchObject({ name: "Read", status: "done" });
    expect(JSON.parse(tool.input)).toEqual({ file_path: "/docs/a.md" });
    expect(chat.items[2]).toMatchObject({ text: "A short document about cats." });
  });

  it("shows the text while it streams", () => {
    const lines = stream.trim().split("\n");
    const partial = lines.slice(0, lines.findIndex((l) => l.includes('"text": " about cats."')));
    const chat = fold(asking, partial);
    expect(chat.busy).toBe(true);
    expect(chat.items.at(-1)).toMatchObject({ kind: "text", text: "A short document" });
  });

  it("takes complete messages when nothing was streamed, a block at a time", () => {
    const message = (content: object[]) => event({ type: "assistant", message: { id: "m1", content } });
    const chat = fold(asking, [
      message([{ type: "thinking", thinking: "…" }]),
      message([{ type: "text", text: "Let me look." }]),
      message([{ type: "tool_use", id: "t1", name: "Glob", input: { pattern: "**/*.md" } }]),
    ]);
    expect(chat.items.slice(1)).toMatchObject([
      { kind: "text", text: "Let me look." },
      { kind: "tool", id: "t1", status: "running" },
    ]);
  });

  it("reports a failed answer", () => {
    const chat = reduce(asking, event({ type: "result", subtype: "error_during_execution", is_error: true, session_id: "s" }));
    expect(chat.busy).toBe(false);
    expect(chat.items.at(-1)).toMatchObject({ kind: "error" });
  });

  it("reports the assistant stopping mid-answer, with why", () => {
    const chat = reduce(asking, event({ type: "mido_exit", stderr: "Invalid API key · Please run /login" }));
    expect(chat.busy).toBe(false);
    expect(chat.items.at(-1)).toEqual({ kind: "error", text: "The assistant stopped: Invalid API key · Please run /login" });
    // Stopped by the user, once the answer was done: nothing to report.
    expect(reduce({ ...asking, busy: false }, event({ type: "mido_exit", stderr: "" })).items).toHaveLength(1);
  });

  it("ignores lines that aren't JSON", () => {
    expect(reduce(asking, "warning: something")).toBe(asking);
  });
});

describe("describeTool", () => {
  const tool = (name: string, input: object): ToolUse => ({
    kind: "tool",
    key: "k",
    id: "t",
    name,
    input: JSON.stringify(input),
    status: "done",
  });

  it("shows paths in the folder relative to it", () => {
    expect(describeTool(tool("Read", { file_path: "/docs/guide/a.md" }), "/docs")).toEqual({
      verb: "Read",
      detail: "guide/a.md",
      path: "/docs/guide/a.md",
    });
    expect(describeTool(tool("Grep", { pattern: "cats" }), "/docs").detail).toBe("“cats”");
  });

  it("copes with input still arriving", () => {
    expect(describeTool({ ...tool("Read", {}), input: '{"file_pa' }, "/docs")).toEqual({ verb: "Read", detail: "", path: undefined });
  });
});

describe("composeMessage", () => {
  it("adds the document being read and the passage asked about", () => {
    expect(composeMessage("Why?", { document: "guide/a.md", quote: "Cats sleep.\nA lot." })).toBe(
      "(I'm reading guide/a.md in Mido.)\n\nAbout this passage:\n\n> Cats sleep.\n> A lot.\n\nWhy?",
    );
    expect(composeMessage("Hi", {})).toBe("Hi");
  });
});

describe("documentsToShare", () => {
  const a = { path: "a.md", content: "# A" };
  const b = { path: "b.md", content: "# B" };

  it("sends each open document once, and again when it changes", () => {
    const first = documentsToShare([a, b]);
    expect(first.documents).toEqual([a, b]);
    expect(documentsToShare([a, b], first.shared).documents).toEqual([]);
    const edited = { ...a, content: "# A, edited" };
    expect(documentsToShare([edited, b], first.shared).documents).toEqual([edited]);
  });

  it("cuts what's too long to send", () => {
    const long = { path: "long.md", content: "x".repeat(150_000) };
    const { documents } = documentsToShare([long, a]);
    expect(documents[0].content.length).toBeLessThan(101_000);
    expect(documents[0].content).toMatch(/cut: too long/);
    expect(documents[1]).toEqual(a);
  });

  it("stops at the limit for one message, leaving the rest for the next", () => {
    const docs = [1, 2, 3, 4].map((n) => ({ path: `${n}.md`, content: "y".repeat(100_000) }));
    const first = documentsToShare(docs);
    expect(first.documents.map((d) => d.path)).toEqual(["1.md", "2.md", "3.md"]);
    expect(documentsToShare(docs, first.shared).documents.map((d) => d.path)).toEqual(["4.md"]);
  });
});

describe("composeMessage with the open files", () => {
  it("puts the documents first, then what's open", () => {
    const message = composeMessage("Compare them", {
      open: ["a.md", "b.md"],
      documents: [{ path: "a.md", content: "# A" }],
    });
    expect(message).toBe('<document path="a.md">\n# A\n</document>\n\n(Open in Mido: a.md, b.md.)\n\nCompare them');
  });
});

describe("notes", () => {
  it("names a note after its question, and keeps the passage asked about", () => {
    expect(noteFor("Perché l'architettura è così? Spiegami bene\nper favore", "Perché **sì**.\n", "Tre livelli.")).toEqual({
      name: "perche-l-architettura-e-cosi-spiegami-bene",
      content: "# Perché l'architettura è così? Spiegami bene\n\n> Tre livelli.\n\nPerché **sì**.\n",
    });
    expect(noteFor("???", "Yes").name).toBe("answer");
  });

  it("splits the chat into questions and their answers", () => {
    const tool: ToolUse = { kind: "tool", key: "t", id: "t", name: "Read", input: "{}", status: "done" };
    const chat = turns([
      { kind: "user", text: "One" },
      { kind: "text", key: "a", text: "Let me look." },
      tool,
      { kind: "text", key: "b", text: "It's one." },
      { kind: "user", text: "Two", quote: "2" },
    ]);
    expect(chat).toEqual([
      { at: 0, question: "One", quote: undefined, answer: "Let me look.\n\nIt's one." },
      { at: 4, question: "Two", quote: "2", answer: "" },
    ]);
  });

  it("tells what it wrote, and what it didn't", () => {
    const write = (status: ToolUse["status"]): ToolUse => ({
      kind: "tool", key: "w", id: "w", name: "Write", input: JSON.stringify({ file_path: "/docs/ai/sum.md" }), status,
    });
    expect(describeTool(write("done"), "/docs")).toMatchObject({ verb: "Wrote", detail: "ai/sum.md" });
    expect(describeTool(write("error"), "/docs").verb).toBe("Didn't write");
  });
});

describe("permission requests", () => {
  // What Claude Code printed when asked to edit a file outside its notes folder.
  const request = event({
    type: "control_request",
    request_id: "r1",
    request: {
      subtype: "can_use_tool",
      tool_name: "Edit",
      input: { file_path: "/docs/doc.md", old_string: "# Doc\n", new_string: "# Doc\nedited\n", replace_all: false },
      tool_use_id: "toolu_1",
    },
  });

  it("shows the request until the user answers it", () => {
    const chat = reduce(asking, request);
    expect(chat.items.at(-1)).toMatchObject({ kind: "permission", requestId: "r1", toolUseId: "toolu_1", name: "Edit", status: "pending" });
    expect(decide(chat, "r1", true).items.at(-1)).toMatchObject({ status: "allowed" });
    expect(decide(chat, "r1", false).items.at(-1)).toMatchObject({ status: "declined" });
  });

  it("lets a request go when the answer ends without one", () => {
    const chat = reduce(reduce(asking, request), event({ type: "mido_exit", stderr: "" }));
    expect(chat.items.find((i) => i.kind === "permission")).toMatchObject({ status: "expired" });
  });

  it("ignores other requests", () => {
    expect(reduce(asking, event({ type: "control_request", request_id: "r2", request: { subtype: "interrupt" } }))).toBe(asking);
  });
});

describe("lineDiff", () => {
  const text = (lines: string[]) => lines.join("\n");
  const diff = (a: string, b: string, context?: number) => lineDiff(a, b, context).map((l) => `${l.type}${l.text}`);

  it("shows the lines changed, with some around them", () => {
    const before = text(["a", "b", "c", "d", "e", "f", "g", "h"]);
    const after = text(["a", "b", "c", "D", "e", "f", "g", "h"]);
    expect(diff(before, after, 1)).toEqual(["…", " c", "-d", "+D", " e", "…"]);
  });

  it("finds lines added and removed in the middle", () => {
    expect(diff(text(["one", "two", "three"]), text(["one", "1.5", "two"]))).toEqual([" one", "+1.5", " two", "-three"]);
  });

  it("is all added for a new text", () => {
    expect(diff("", "x\ny")).toEqual(["-", "+x", "+y"]);
  });
});
