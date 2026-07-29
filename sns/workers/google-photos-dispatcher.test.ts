import { describe, expect, it, vi } from "vitest";
import {
  dispatchGooglePhotosImport,
  shouldDispatchGooglePhotosImport,
} from "./google-photos-dispatcher";

describe("dispatchGooglePhotosImport", () => {
  it("dispatches the importer workflow on main", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await dispatchGooglePhotosImport("test-token", fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/gdg-jp/gdgjp/actions/workflows/google-photos-import.yml/dispatches",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-token",
          "user-agent": "gdgjp-album-cron",
        }),
        body: JSON.stringify({ ref: "main" }),
      }),
    );
  });

  it("surfaces failed dispatches", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('{"message":"Resource not accessible"}', { status: 403 }));

    await expect(dispatchGooglePhotosImport("test-token", fetcher)).rejects.toThrow("status 403");
  });

  it("dispatches once every five minutes", () => {
    expect(shouldDispatchGooglePhotosImport(Date.UTC(2026, 6, 29, 1, 5))).toBe(true);
    expect(shouldDispatchGooglePhotosImport(Date.UTC(2026, 6, 29, 1, 6))).toBe(false);
  });
});
