import { describe, expect, it } from "vitest";
import { generateSlug } from "./ingestion-pipeline.server";

describe("generateSlug", () => {
  it("converts English title to slug", () => {
    expect(generateSlug("Hello World")).toBe("hello-world");
  });

  it("strips non-ASCII from Japanese title (backward compat)", () => {
    expect(generateSlug("GDGoC運営Tips")).toBe("gdgoctips");
  });

  it("uses englishHint when provided", () => {
    expect(generateSlug("日本語タイトル", "Event Reflection Summary")).toBe(
      "event-reflection-summary",
    );
  });

  it("falls back to title when englishHint is empty", () => {
    expect(generateSlug("GDGoC運営Tips", "")).toBe("gdgoctips");
  });

  it("falls back to title when englishHint is whitespace", () => {
    expect(generateSlug("GDGoC運営Tips", "   ")).toBe("gdgoctips");
  });

  it("returns page-{timestamp} fallback for empty result", () => {
    expect(generateSlug("日本語のみ")).toMatch(/^page-\d+$/);
  });

  it("truncates at 80 characters", () => {
    const longTitle = "a".repeat(100);
    expect(generateSlug(longTitle).length).toBe(80);
  });

  it("collapses multiple hyphens", () => {
    expect(generateSlug("hello   world")).toBe("hello-world");
  });

  it("trims leading and trailing hyphens", () => {
    expect(generateSlug(" hello world ")).toBe("hello-world");
  });

  it("handles full-width spaces", () => {
    expect(generateSlug("hello\u3000world")).toBe("hello-world");
  });
});
