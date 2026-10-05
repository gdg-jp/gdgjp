import { describe, expect, it } from "vitest";
import {
  isEditableStatus,
  isValidPostText,
  isValidScheduledAt,
  normalizeTagHandles,
  recomputeDraftStatus,
  validateNewMedia,
} from "./post-policy";

describe("recomputeDraftStatus", () => {
  it("waits for a photo only when a photo is required and none is attached", () => {
    expect(recomputeDraftStatus("photo_required", 0)).toBe("waiting_for_photo");
    expect(recomputeDraftStatus("photo_required", 1)).toBe("scheduled");
    expect(recomputeDraftStatus("scheduled", 0)).toBe("scheduled");
    expect(recomputeDraftStatus("scheduled", 2)).toBe("scheduled");
  });
});

describe("isEditableStatus", () => {
  it("locks a post once it is posting or published", () => {
    expect(isEditableStatus("scheduled")).toBe(true);
    expect(isEditableStatus("waiting_for_photo")).toBe(true);
    expect(isEditableStatus("failed")).toBe(true);
    expect(isEditableStatus("needs_confirmation")).toBe(true);
    expect(isEditableStatus("posting")).toBe(false);
    expect(isEditableStatus("published")).toBe(false);
  });
});

describe("isValidPostText", () => {
  it("rejects blank text and text over the X limit", () => {
    expect(isValidPostText("")).toBe(false);
    expect(isValidPostText("   \n ")).toBe(false);
    expect(isValidPostText("hello world")).toBe(true);
    expect(isValidPostText("a".repeat(281))).toBe(false);
  });
});

describe("isValidScheduledAt", () => {
  it("accepts an ISO timestamp and rejects garbage", () => {
    expect(isValidScheduledAt(new Date().toISOString())).toBe(true);
    expect(isValidScheduledAt("not-a-date")).toBe(false);
  });
});

describe("validateNewMedia", () => {
  const image = { size: 1000, contentType: "image/png" };

  it("passes up to four images within the size and type limits", () => {
    expect(validateNewMedia(2, [image, image])).toBeNull();
  });

  it("rejects a fifth image", () => {
    expect(validateNewMedia(4, [image])).toBe("too_many_images");
  });

  it("rejects an oversized image", () => {
    expect(validateNewMedia(0, [{ size: 5 * 1024 * 1024 + 1, contentType: "image/png" }])).toBe(
      "image_too_large",
    );
  });

  it("rejects a non-image file", () => {
    expect(validateNewMedia(0, [{ size: 10, contentType: "application/pdf" }])).toBe("not_image");
  });
});

describe("normalizeTagHandles", () => {
  it("splits a single raw field on whitespace and commas", () => {
    expect(normalizeTagHandles(["@gdg_tokyo @gdg_osaka, @gdg_kyoto"])).toEqual([
      "@gdg_tokyo",
      "@gdg_osaka",
      "@gdg_kyoto",
    ]);
  });

  it("drops blanks and caps the list at ten", () => {
    expect(normalizeTagHandles([" ", ""])).toEqual([]);
    expect(normalizeTagHandles(Array.from({ length: 15 }, (_, i) => `@h${i}`))).toHaveLength(10);
  });
});
