import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAccessibleGoogleDriveItem,
  isGoogleDriveFolder,
  isGoogleSpreadsheet,
} from "./drive.server";

describe("getAccessibleGoogleDriveItem", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("checks the selected item using the OAuth access token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "folder/with spaces",
          name: "精算書",
          mimeType: "application/vnd.google-apps.folder",
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const item = await getAccessibleGoogleDriveItem("access-token", "folder/with spaces");

    expect(item.name).toBe("精算書");
    expect(isGoogleDriveFolder(item)).toBe(true);
    expect(isGoogleSpreadsheet(item)).toBe(false);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("folder%2Fwith%20spaces");
    expect(url).toContain("supportsAllDrives=true");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer access-token");
  });

  it("returns an actionable error when drive.file access was not granted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(getAccessibleGoogleDriveItem("access-token", "folder-id")).rejects.toThrow(
      "Google Pickerでもう一度選択してください",
    );
  });

  it("rejects an invalid Drive API response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ id: "different-id", name: "精算書", mimeType: "invalid" }),
        ),
    );

    await expect(getAccessibleGoogleDriveItem("access-token", "folder-id")).rejects.toThrow(
      "不正な項目情報",
    );
  });

  it("identifies a Google spreadsheet", () => {
    const item = {
      id: "sheet-id",
      name: "template",
      mimeType: "application/vnd.google-apps.spreadsheet",
    };
    expect(isGoogleSpreadsheet(item)).toBe(true);
    expect(isGoogleDriveFolder(item)).toBe(false);
  });
});
