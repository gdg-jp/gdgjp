import { describe, expect, it } from "vitest";
import { googlePhotosImportOperation } from "./google-photos-importer";

describe("googlePhotosImportOperation", () => {
  it("accepts the public API URL", () => {
    expect(googlePhotosImportOperation("https://sns.gdgs.jp/api/google-photos-import/claim")).toBe(
      "claim",
    );
  });

  it("tolerates a mistakenly suffixed endpoint variable", () => {
    expect(
      googlePhotosImportOperation("https://sns.gdgs.jp/api/google-photos-import/claim/claim"),
    ).toBe("claim");
  });
});
