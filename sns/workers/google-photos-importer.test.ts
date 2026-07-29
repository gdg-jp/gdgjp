import { describe, expect, it } from "vitest";
import {
  googlePhotosImportOperation,
  googlePhotosKnownMediaChunks,
  handleGooglePhotosImport,
} from "./google-photos-importer";

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

  it("splits large known-media lookups into D1-safe chunks", () => {
    const ids = Array.from({ length: 188 }, (_, index) => `photo-${index}`);

    const chunks = googlePhotosKnownMediaChunks(ids);

    expect(chunks).toHaveLength(4);
    expect(chunks.map((chunk) => chunk.length)).toEqual([50, 50, 50, 38]);
    expect(chunks.flat()).toEqual(ids);
  });

  it("queries known media in chunks for a 188-photo album", async () => {
    const bindings: unknown[][] = [];
    const env = {
      DB: {
        prepare: () => ({
          bind: (...values: unknown[]) => {
            bindings.push(values);
            return {
              all: async () => ({
                results: values.slice(1).map((stable_photo_id) => ({ stable_photo_id })),
              }),
            };
          },
        }),
      },
    } as unknown as Env;
    const stablePhotoIds = Array.from({ length: 188 }, (_, index) => `photo-${index}`);

    const response = await handleGooglePhotosImport(
      new Request("https://sns.gdgs.jp/api/google-photos-import/known", {
        method: "POST",
        body: JSON.stringify({ albumId: "album-1", stablePhotoIds }),
      }),
      env,
    );

    expect(bindings.map((values) => values.length)).toEqual([51, 51, 51, 39]);
    expect(await response.json()).toEqual({ known: stablePhotoIds });
  });
});
