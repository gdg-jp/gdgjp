import { describe, expect, it } from "vitest";
import { previewImageSrc } from "./preview-image";

describe("previewImageSrc", () => {
  it("shows web images", () => {
    expect(previewImageSrc(" https://img.gdgs.jp/a.png ")).toBe("https://img.gdgs.jp/a.png");
    expect(previewImageSrc("http://example.com/b.jpg")).toBe("http://example.com/b.jpg");
  });

  it("shows nothing for text that is not a web URL", () => {
    expect(previewImageSrc("javascript:alert(1)")).toBeNull();
    expect(previewImageSrc("data:image/svg+xml,<svg onload=alert(1)>")).toBeNull();
    expect(previewImageSrc('" onerror="alert(1)')).toBeNull();
    expect(previewImageSrc("")).toBeNull();
  });
});
