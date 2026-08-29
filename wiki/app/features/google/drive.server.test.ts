import { afterEach, describe, expect, it, vi } from "vitest";
import { driveFilesUrl, getDriveFileName } from "./drive.server";

describe("driveFilesUrl", () => {
  it("always sets supportsAllDrives=true even when caller passes false", () => {
    const url = new URL(driveFilesUrl("abc123", { fields: "name", supportsAllDrives: "false" }));
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url.searchParams.get("fields")).toBe("name");
    expect(url.pathname).toBe("/drive/v3/files/abc123");
  });

  it("preserves caller params and path-encodes the file ID", () => {
    const url = new URL(driveFilesUrl("a/b+c", { fields: "name,mimeType", alt: "media" }));
    expect(url.pathname).toBe("/drive/v3/files/a%2Fb%2Bc");
    expect(url.searchParams.get("fields")).toBe("name,mimeType");
    expect(url.searchParams.get("alt")).toBe("media");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
  });
});

describe("getDriveFileName", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches metadata via driveFilesUrl", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("supportsAllDrives")).toBe("true");
      expect(url.searchParams.get("fields")).toBe("name");
      return Response.json({ name: "Quarterly report" });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(getDriveFileName("file-id", "token")).resolves.toBe("Quarterly report");
    expect(fetch).toHaveBeenCalledOnce();
  });
});
