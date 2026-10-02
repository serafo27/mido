// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { changeLetter, isDocumentPath } from "./useGit";

describe("isDocumentPath", () => {
  it("takes Markdown documents and Mido's comments, anywhere in the repository", () => {
    for (const path of ["README.md", "docs/a/B.MD", "notes.markdown", "x.mdx", ".mido/comments/a.md/t/1.json", "docs/.mido/comments/b.md/t/2.json"]) {
      expect(isDocumentPath(path), path).toBe(true);
    }
  });

  it("leaves out everything else", () => {
    for (const path of ["src/main.rs", "package.json", "md", "notes.md.bak", ".mido/settings.json", "image.png"]) {
      expect(isDocumentPath(path), path).toBe(false);
    }
  });
});

describe("changeLetter", () => {
  it("shows untracked files as U and conflicts as !", () => {
    expect(changeLetter({ staged: null, unstaged: "?", conflicted: false })).toBe("U");
    expect(changeLetter({ staged: "M", unstaged: null, conflicted: false })).toBe("M");
    expect(changeLetter({ staged: null, unstaged: null, conflicted: true })).toBe("!");
  });
});
