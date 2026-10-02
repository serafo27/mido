// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { history } from "@codemirror/commands";
import { EditorView, type Command } from "@codemirror/view";
import {
  formatAt,
  insertCodeBlock,
  insertFootnote,
  insertTable,
  setHeading,
  tableMarkdown,
  toggleBold,
  toggleItalic,
  toggleList,
} from "./formatting";

/** An editor holding `doc`, where `|` marks the cursor and `«`…`»` a selection. */
function editor(doc: string) {
  const from = doc.search(/[|«]/);
  const text = doc.replace(/[|«»]/g, "");
  const to = doc.includes("«") ? doc.indexOf("»") - 1 : from;
  const state = EditorState.create({
    doc: text,
    selection: EditorSelection.single(from, to),
    extensions: [markdown({ base: markdownLanguage }), history()],
  });
  return new EditorView({ state });
}

/** The document after `command`, with the selection marked like `editor`'s. */
function after(doc: string, command: Command): string {
  const view = editor(doc);
  command(view);
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  view.destroy();
  return from === to
    ? text.slice(0, from) + "|" + text.slice(from)
    : text.slice(0, from) + "«" + text.slice(from, to) + "»" + text.slice(to);
}

describe("inline markers", () => {
  it("wraps and unwraps the selection", () => {
    expect(after("a «word» b", toggleBold)).toBe("a **«word»** b");
    expect(after("a **«word»** b", toggleBold)).toBe("a «word» b");
    expect(after("a «**word**» b", toggleBold)).toBe("a «word» b");
  });

  it("makes bold text bold-italic rather than unbolding it", () => {
    expect(after("**«word»**", toggleItalic)).toBe("***«word»***");
    expect(after("***«word»***", toggleItalic)).toBe("**«word»**");
    expect(after("*«word»*", toggleItalic)).toBe("«word»");
  });
});

describe("headings", () => {
  it("sets, changes and removes a heading", () => {
    expect(after("Title|", setHeading(2))).toBe("## Title|");
    expect(after("### Ti|tle", setHeading(1))).toBe("# Ti|tle");
    expect(after("# Ti|tle", setHeading(0))).toBe("Ti|tle");
  });
});

describe("lists", () => {
  it("turns lines into a numbered list, skipping blank ones", () => {
    expect(after("«one\n\ntwo»", toggleList("ordered"))).toBe("1. «one\n\n2. two»");
  });

  it("switches between list kinds, keeping indentation", () => {
    expect(after("- one\n  - t|wo", toggleList("task"))).toBe("- one\n  - [ ] t|wo");
    expect(after("1. o|ne", toggleList("bullet"))).toBe("- o|ne");
  });

  it("removes the list when every line already is one", () => {
    expect(after("«- one\n- two»", toggleList("bullet"))).toBe("«one\ntwo»");
    expect(after("> q|uote", toggleList("quote"))).toBe("q|uote");
  });

  it("doesn't take the line a selection ends at the start of", () => {
    expect(after("«one\n»two", toggleList("bullet"))).toBe("- «one\n»two");
  });
});

describe("blocks", () => {
  it("sets a code block apart with blank lines", () => {
    expect(after("text|", insertCodeBlock())).toBe("text\n\n```\n|\n```\n");
    expect(after("a\n«code»\nb", insertCodeBlock("js"))).toBe("a\n\n```js\ncode|\n```\n\nb");
  });

  it("inserts a table with its first header selected", () => {
    expect(tableMarkdown(1, 2)).toBe("| Column 1 | Column 2 |\n| -------- | -------- |\n|          |          |");
    expect(after("|", insertTable(1, 1))).toBe("| «Column 1» |\n| -------- |\n|          |\n");
  });

  it("numbers footnotes after the ones in use", () => {
    expect(after("See[^1] th|is.\n\n[^1]: one", insertFootnote)).toBe("See[^1] th[^2]is.\n\n[^1]: one\n\n[^2]: |");
  });
});

describe("formatAt", () => {
  const format = (doc: string) => {
    const view = editor(doc);
    ensureSyntaxTree(view.state, view.state.doc.length);
    const result = formatAt(view.state);
    view.destroy();
    return result;
  };

  it("reads the inline formatting at the cursor", () => {
    expect(format("a **b|old** c")).toMatchObject({ bold: true, italic: false });
    expect(format("a *it|alic* c")).toMatchObject({ bold: false, italic: true });
    expect(format("a `co|de` [link](x)")).toMatchObject({ code: true });
    expect(format("plain **bold**|")).toMatchObject({ bold: false });
  });

  it("reads the line's heading and list", () => {
    expect(format("### He|ading")).toMatchObject({ heading: 3, list: null });
    expect(format("- [x] ta|sk")).toMatchObject({ list: "task" });
    expect(format("12. it|em")).toMatchObject({ list: "ordered" });
  });

  it("knows when the cursor is in a code block", () => {
    expect(format("```\nco|de\n```")).toMatchObject({ codeBlock: true });
  });
});
