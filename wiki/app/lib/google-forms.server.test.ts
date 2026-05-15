import { describe, expect, it } from "vitest";
import { extractFormId, isGoogleFormUrl } from "./google-forms.server";

describe("google-forms URL utilities", () => {
  it("extracts formId from standard Google Forms URL", () => {
    expect(extractFormId("https://docs.google.com/forms/d/1BxiMVs0XRA5nFMdj2Sfl7I/viewform")).toBe(
      "1BxiMVs0XRA5nFMdj2Sfl7I",
    );
  });

  it("extracts formId from edit URL", () => {
    expect(extractFormId("https://docs.google.com/forms/d/abc-123_XYZ/edit")).toBe("abc-123_XYZ");
  });

  it("returns null for non-form URLs", () => {
    expect(extractFormId("https://docs.google.com/document/d/abc/edit")).toBeNull();
    expect(extractFormId("https://example.com")).toBeNull();
    expect(extractFormId("")).toBeNull();
  });

  it("validates Google Form URLs", () => {
    expect(isGoogleFormUrl("https://docs.google.com/forms/d/1BxiMVs0XRA/viewform")).toBe(true);
    expect(isGoogleFormUrl("https://docs.google.com/forms/d/1BxiMVs0XRA/edit")).toBe(true);
    expect(isGoogleFormUrl("https://docs.google.com/document/d/abc/edit")).toBe(false);
    expect(isGoogleFormUrl("https://example.com")).toBe(false);
  });
});
