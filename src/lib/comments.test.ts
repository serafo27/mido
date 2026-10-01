import { describe, expect, it } from "vitest";
import {
  buildThreads,
  createAnchor,
  findRenderedText,
  locate,
  sameAuthor,
  serializeEvents,
  trimRange,
  ulid,
  visibleWordsOf,
  type CommentEvent,
  type CommentFileData,
} from "./comments";

const ada = { name: "Ada Lovelace", email: "ada@example.com" };
const bob = { name: "Bob", email: "" };
const anchor = { exact: "text", prefix: "", suffix: "", line: 1 };

const event = (id: string, rest: Partial<CommentEvent> & Pick<CommentEvent, "type">) =>
  ({ id, thread: "T", author: ada, at: "2026-10-01T10:00:00.000Z", ...rest }) as CommentEvent;
const file = (name: string, ...events: CommentEvent[]): CommentFileData => ({
  thread: "T",
  name,
  content: serializeEvents(events),
});

describe("ulid", () => {
  it("makes ids that sort in creation order, even within a millisecond", () => {
    const ids = [ulid(1000), ulid(1000), ulid(1000), ulid(2000)];
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe("buildThreads", () => {
  it("merges the files of a thread, dropping duplicate events", () => {
    const create = event("A", { type: "create", body: "First", anchor });
    const reply = event("B", { type: "reply", body: "Second", author: bob });
    const [thread] = buildThreads([file("A", create), file("B", reply), file("C", create, reply)]);
    expect(thread.comments.map((c) => c.body)).toEqual(["First", "Second"]);
    expect(thread.files).toEqual(["A", "B", "C"]);
    expect(thread.events).toHaveLength(2);
    expect(thread.resolved).toBe(false);
  });

  it("follows resolve and reopen in time order", () => {
    const create = event("A", { type: "create", body: "x", anchor });
    expect(buildThreads([file("A", create), file("B", event("B", { type: "resolve" }))])[0].resolved).toBe(true);
    expect(
      buildThreads([file("A", create, event("B", { type: "resolve" })), file("C", event("C", { type: "reopen" }))])[0]
        .resolved,
    ).toBe(false);
  });

  it("reopens a resolved thread when a later reply arrives", () => {
    // Resolved and compacted on one branch, replied to on another.
    const resolvedFile = file("R", event("A", { type: "create", body: "x", anchor }), event("B", { type: "resolve" }));
    const reply = file("C", event("C", { type: "reply", body: "Wait" }));
    expect(buildThreads([resolvedFile, reply])[0].resolved).toBe(false);
  });

  it("hides deleted comments, and the whole thread when its first one is deleted", () => {
    const create = event("A", { type: "create", body: "x", anchor });
    const reply = event("B", { type: "reply", body: "y" });
    const [thread] = buildThreads([file("A", create, reply), file("C", event("C", { type: "delete", target: "B" }))]);
    expect(thread.comments.map((c) => c.id)).toEqual(["A"]);
    expect(buildThreads([file("A", create), file("D", event("D", { type: "delete", target: "A" }))])).toEqual([]);
  });

  it("skips broken files and events of other threads", () => {
    const create = event("A", { type: "create", body: "x", anchor });
    const stray = { ...event("B", { type: "reply", body: "elsewhere" }), thread: "OTHER" } as CommentEvent;
    const threads = buildThreads([file("A", create, stray), { thread: "T", name: "Z", content: "<<<<<<< HEAD" }]);
    expect(threads[0].comments.map((c) => c.body)).toEqual(["x"]);
  });
});

describe("sameAuthor", () => {
  it("compares emails when both have one, names otherwise", () => {
    expect(sameAuthor(ada, { name: "A. L.", email: "ADA@example.com" })).toBe(true);
    expect(sameAuthor(bob, { name: "Bob", email: "bob@example.com" })).toBe(true);
    expect(sameAuthor(ada, bob)).toBe(false);
  });
});

describe("anchors", () => {
  const source = "# Title\n\nThe quick brown fox.\n\nAnother quick brown fox here.\n";

  it("finds the text again after edits around it", () => {
    const from = source.indexOf("quick brown", 20);
    const a = createAnchor(source, { from, to: from + "quick brown".length });
    expect(a.line).toBe(5);
    const edited = "# New title\n\nIntro.\n\n" + source.slice(9);
    const found = locate(edited, a)!;
    expect(edited.slice(found.from, found.to)).toBe("quick brown");
    // The second copy, the one with the same surroundings.
    expect(edited.slice(found.from - 8, found.from)).toBe("Another ");
  });

  it("finds edited text between its old surroundings", () => {
    const from = source.indexOf("brown");
    const a = createAnchor(source, { from, to: from + "brown".length });
    const edited = source.replace("quick brown fox.", "quick red fox.");
    const found = locate(edited, a)!;
    expect(edited.slice(found.from, found.to)).toBe("red");
  });

  it("gives up when the text and its surroundings are gone", () => {
    const from = source.indexOf("brown");
    const a = createAnchor(source, { from, to: from + 5 });
    expect(locate("Something else entirely.", a)).toBeNull();
  });

  it("trims whitespace off a selection", () => {
    expect(trimRange("  hello \n", { from: 0, to: 9 })).toEqual({ from: 2, to: 7 });
  });
});

describe("rendered text", () => {
  const source = "Some **bold** text with a [link](https://example.com/page) in it.\n";

  it("maps text selected on the page back to the source, across markup", () => {
    const range = findRenderedText(source, "bold text with a link", 0, source.length)!;
    expect(source.slice(range.from, range.to)).toBe("bold** text with a [link");
  });

  it("maps plain text directly", () => {
    const range = findRenderedText(source, "Some ", 0, source.length)!;
    expect(source.slice(range.from, range.to)).toBe("Some");
  });

  it("leaves out words the page doesn't show", () => {
    expect(visibleWordsOf("a [link](https://example.com) and <b>bold</b>")).toEqual(["a", "link", "and", "bold"]);
  });
});
