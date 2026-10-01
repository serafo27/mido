import { describe, expect, it } from "vitest";
import { assetName, imageMarkdown, isImageFile } from "./images";

describe("isImageFile", () => {
  it("accepts images by type or extension", () => {
    expect(isImageFile(new File([""], "a.bin", { type: "image/png" }))).toBe(true);
    expect(isImageFile(new File([""], "Photo.JPEG"))).toBe(true);
    expect(isImageFile(new File([""], "notes.md", { type: "text/markdown" }))).toBe(false);
  });
});

describe("assetName", () => {
  const now = new Date(2026, 9, 1, 9, 5, 7);

  it("keeps real file names", () => {
    expect(assetName("diagram.png", now)).toBe("diagram.png");
    expect(assetName("Screen Shot 2026.png", now)).toBe("Screen Shot 2026.png");
  });

  it("dates generic clipboard names", () => {
    expect(assetName("image.png", now)).toBe("image-20261001-090507.png");
    expect(assetName("Image.JPG", now)).toBe("image-20261001-090507.JPG");
    expect(assetName("", now)).toBe("image-20261001-090507");
  });
});

describe("imageMarkdown", () => {
  it("links the asset with its name as alt text", () => {
    expect(imageMarkdown("assets/diagram-2.png")).toBe("![diagram-2](assets/diagram-2.png)");
    expect(imageMarkdown("assets/città.jpg")).toBe("![città](assets/città.jpg)");
  });

  it("escapes characters that would break the link", () => {
    expect(imageMarkdown("assets/a (1).png")).toBe("![a (1)](assets/a%20%281%29.png)");
  });
});
