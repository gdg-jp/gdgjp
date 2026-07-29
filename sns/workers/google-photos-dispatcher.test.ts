import { describe, expect, it, vi } from "vitest";
import { dispatchGooglePhotosImport } from "./google-photos-dispatcher";

describe("dispatchGooglePhotosImport", () => {
  it("dispatches the importer workflow on main", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await dispatchGooglePhotosImport(
      "test-token",
      { albumId: "album-1", albumUrl: "https://photos.app.goo.gl/example", runId: "run-1" },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/gdg-jp/gdgjp/actions/workflows/google-photos-import.yml/dispatches",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-token",
          "user-agent": "gdgjp-album-cron",
        }),
        body: JSON.stringify({
          ref: "main",
          inputs: {
            album_id: "album-1",
            album_url: "https://photos.app.goo.gl/example",
            run_id: "run-1",
          },
        }),
      }),
    );
  });

  it("surfaces failed dispatches", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('{"message":"Resource not accessible"}', { status: 403 }));

    await expect(
      dispatchGooglePhotosImport(
        "test-token",
        { albumId: "album-1", albumUrl: "https://photos.app.goo.gl/example", runId: "run-1" },
        fetcher,
      ),
    ).rejects.toThrow("status 403");
  });
});
