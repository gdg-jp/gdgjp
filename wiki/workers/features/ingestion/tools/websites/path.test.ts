import { describe, expect, it } from "vitest";
import { websiteWorkspacePath } from "./path";

describe("websiteWorkspacePath", () => {
  it("maps URL paths below the websites mount without a file extension", () => {
    expect(websiteWorkspacePath("https://Example.com/events/build-with-ai/#schedule")).toEqual({
      canonicalUrl: "https://example.com/events/build-with-ai",
      path: "/websites/example.com/events/build-with-ai",
      parentPath: "/websites/example.com/events",
      title: "build-with-ai",
    });
  });

  it("keeps query values out of model-visible paths and normalizes query order", () => {
    const left = websiteWorkspacePath("https://example.com/search?secret=value&q=AI");
    const right = websiteWorkspacePath("https://example.com/search?q=AI&secret=value");
    expect(left).toEqual(right);
    expect(left.path).toMatch(/^\/websites\/example\.com\/search~q-[a-f0-9]{8}$/);
    expect(left.path).not.toContain("secret");
  });
});
