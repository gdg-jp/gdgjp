import { describe, expect, it } from "vitest";
import { classifySourceUrl } from "~/lib/sources.server";

describe("classifySourceUrl", () => {
  it("accepts Google Docs URLs as google-doc", () => {
    expect(classifySourceUrl("https://docs.google.com/document/d/abc123XYZ/edit")).toEqual({
      ok: true,
      kind: "google-doc",
      url: "https://docs.google.com/document/d/abc123XYZ/edit",
      externalId: "abc123XYZ",
    });
  });

  it("classifies Sheets and Slides independently and preserves a picker title", () => {
    expect(
      classifySourceUrl("https://docs.google.com/u/0/spreadsheets/d/sheet123/edit", "Budget 2026"),
    ).toMatchObject({
      ok: true,
      kind: "google-sheet",
      externalId: "sheet123",
      title: "Budget 2026",
    });
    expect(
      classifySourceUrl("https://docs.google.com/presentation/d/slides123/edit", "Kickoff slides"),
    ).toMatchObject({
      ok: true,
      kind: "google-slides",
      externalId: "slides123",
      title: "Kickoff slides",
    });
  });

  it("accepts http(s) websites", () => {
    expect(classifySourceUrl("https://example.com/page")).toMatchObject({
      ok: true,
      kind: "website",
      url: "https://example.com/page",
    });
  });

  it("rejects unrecognizable or unsupported URLs with a 4xx-shaped error", () => {
    expect(classifySourceUrl("")).toEqual({ ok: false, error: "url_required" });
    expect(classifySourceUrl("not-a-url")).toEqual({ ok: false, error: "invalid_url" });
    expect(classifySourceUrl("ftp://example.com")).toEqual({
      ok: false,
      error: "unsupported_url",
    });
    expect(classifySourceUrl("https://docs.google.com/forms/d/e/1FAIpQLSf/viewform")).toEqual({
      ok: false,
      error: "unsupported_url",
    });
  });
});
