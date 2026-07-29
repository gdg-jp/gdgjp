import { describe, expect, it } from "vitest";
import {
  claimDueGooglePhotosAlbum,
  googlePhotosImportOperation,
  googlePhotosKnownMediaChunks,
  handleGooglePhotosImport,
} from "./google-photos-importer";

describe("googlePhotosImportOperation", () => {
  it("claims a due album before dispatching an importer workflow", async () => {
    const calls: { query: string; values: unknown[] }[] = [];
    const env = {
      DB: {
        prepare: (query: string) => ({
          bind: (...values: unknown[]) => {
            calls.push({ query, values });
            return {
              first: async () => ({
                id: "album-1",
                album_url: "https://photos.app.goo.gl/example",
              }),
              run: async () => ({ meta: { changes: 1 } }),
            };
          },
        }),
      },
    } as unknown as Env;

    await expect(claimDueGooglePhotosAlbum(env, "2026-07-29T00:00:00.000Z")).resolves.toMatchObject(
      {
        id: "album-1",
        url: "https://photos.app.goo.gl/example",
      },
    );
    expect(calls).toHaveLength(3);
    expect(calls[0].values).toEqual(["2026-07-29T00:00:00.000Z", "2026-07-29T00:00:00.000Z"]);
    expect(calls[1].query).toContain("active_run_id");
    expect(calls[2].query).toContain("google_photos_poll_runs");
  });

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
              first: async () => ({ id: "album-1" }),
              all: async () => ({
                results: values.slice(1).map((stable_photo_id) => ({
                  stable_photo_id,
                  blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
                })),
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
        body: JSON.stringify({ albumId: "album-1", runId: "run-1", stablePhotoIds }),
      }),
      env,
    );

    expect(bindings.map((values) => values.length)).toEqual([3, 51, 51, 51, 39]);
    expect(await response.json()).toEqual({ known: stablePhotoIds });
  });
});
