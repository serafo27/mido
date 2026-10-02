import { describe, expect, it } from "vitest";
import { basename, decodeLink, dirname, splitLink, isInside, isMarkdown, join, relative, resolve, tildify } from "./paths";

describe("basename / dirname", () => {
  it("splits POSIX and Windows paths", () => {
    expect(basename("/notes/a.md")).toBe("a.md");
    expect(dirname("/notes/a.md")).toBe("/notes");
    expect(basename("C:\\notes\\a.md")).toBe("a.md");
    expect(dirname("C:\\notes\\a.md")).toBe("C:\\notes");
  });

  it("keeps the root", () => {
    expect(dirname("/a.md")).toBe("/");
  });
});

describe("join", () => {
  it("adds a separator only when needed", () => {
    expect(join("/notes", "a.md")).toBe("/notes/a.md");
    expect(join("/notes/", "a.md")).toBe("/notes/a.md");
    expect(join("C:\\notes", "a.md")).toBe("C:\\notes\\a.md");
  });
});

describe("resolve", () => {
  it("resolves relative paths against a directory", () => {
    expect(resolve("/notes/sub", "a.md")).toBe("/notes/sub/a.md");
    expect(resolve("/notes/sub", "./img/x.png")).toBe("/notes/sub/img/x.png");
    expect(resolve("/notes/sub", "../a.md")).toBe("/notes/a.md");
  });

  it("returns absolute paths unchanged", () => {
    expect(resolve("/notes", "/etc/hosts")).toBe("/etc/hosts");
    expect(resolve("/notes", "C:\\x.md")).toBe("C:\\x.md");
  });

  it("never goes above the filesystem root", () => {
    expect(resolve("/notes", "../../../a.md")).toBe("/a.md");
  });
});

describe("isInside", () => {
  it("matches the folder itself and its descendants", () => {
    expect(isInside("/notes", "/notes")).toBe(true);
    expect(isInside("/notes", "/notes/sub/a.md")).toBe(true);
  });

  it("doesn't match siblings that share a prefix", () => {
    expect(isInside("/notes", "/notes-old/a.md")).toBe(false);
    expect(isInside("/notes/a", "/notes/ab.md")).toBe(false);
  });
});

describe("relative", () => {
  it("strips the root", () => {
    expect(relative("/notes", "/notes/sub/a.md")).toBe("sub/a.md");
    expect(relative("/notes", "/other/a.md")).toBe("/other/a.md");
  });
});

describe("isMarkdown", () => {
  it("recognises Markdown extensions, case-insensitively", () => {
    for (const name of ["a.md", "a.MD", "a.markdown", "a.mdown", "a.mkd", "a.mdx"]) {
      expect(isMarkdown(name), name).toBe(true);
    }
    for (const name of ["a.txt", "a.md.bak", "md", "a.mdx.png"]) {
      expect(isMarkdown(name), name).toBe(false);
    }
  });
});

describe("decodeLink", () => {
  it("decodes percent-escapes", () => {
    expect(decodeLink("my%20notes/a.md")).toBe("my notes/a.md");
    expect(decodeLink("caf%C3%A9", decodeURIComponent)).toBe("café");
  });

  it("keeps a link with a malformed escape as written", () => {
    expect(decodeLink("100%.png")).toBe("100%.png");
    expect(decodeLink("a%zz", decodeURIComponent)).toBe("a%zz");
  });
});

describe("splitLink", () => {
  it("separates the path from the fragment, decoding both", () => {
    expect(splitLink("other%20doc.md#caf%C3%A9")).toEqual({ path: "other doc.md", anchor: "café" });
    expect(splitLink("#section")).toEqual({ path: "", anchor: "section" });
    expect(splitLink("a.md")).toEqual({ path: "a.md", anchor: "" });
  });

  it("splits at the first #, keeping the rest in the fragment", () => {
    expect(splitLink("a.md#x#y")).toEqual({ path: "a.md", anchor: "x#y" });
  });
});

describe("tildify", () => {
  it("shows the home folder as ~", () => {
    expect(tildify("/Users/ada/notes")).toBe("~/notes");
    expect(tildify("/Users/ada")).toBe("~");
    expect(tildify("/home/ada/docs/a")).toBe("~/docs/a");
  });

  it("leaves other paths alone", () => {
    expect(tildify("/Users")).toBe("/Users");
    expect(tildify("/Volumes/Data/notes")).toBe("/Volumes/Data/notes");
    expect(tildify("C:\\Users\\ada")).toBe("C:\\Users\\ada");
  });
});
