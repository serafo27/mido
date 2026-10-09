import { describe, expect, it } from "vitest";
import { composeMessage, describeTool, EMPTY_CHAT, reduce, type Chat, type ToolUse } from "./ai";
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
