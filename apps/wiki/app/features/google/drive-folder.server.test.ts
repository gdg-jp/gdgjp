import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DRIVE_FOLDER_MIME,
  MAX_FOLDER_FILES,
  isDriveFolderId,
  listDriveFolderSourceFiles,
} from "./drive-folder.server";

const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";
const SLIDES = "application/vnd.google-apps.presentation";

type Item = {
  id: string;
  name?: string;
  mimeType: string;
  shortcutDetails?: { targetId: string; targetMimeType: string };
};

/** Fake Drive `files.list`: folder id → pages of children. */
function stubDrive(tree: Record<string, Item[][]>) {
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
    const folderId = url.searchParams.get("q")?.match(/^'([^']+)' in parents/)?.[1] ?? "";
    const pages = tree[folderId];
    if (!pages) return new Response("not found", { status: 404 });
    const page = Number(url.searchParams.get("pageToken") ?? "0");
    return Response.json({
      files: pages[page] ?? [],
      ...(page + 1 < pages.length ? { nextPageToken: String(page + 1) } : {}),
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("listDriveFolderSourceFiles", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks sub-folders and pages, keeping only Docs / Sheets / Slides", async () => {
    stubDrive({
      root: [
        [
          { id: "sub", name: "Sub", mimeType: DRIVE_FOLDER_MIME },
          { id: "doc-1", name: "Minutes", mimeType: DOC },
          { id: "pdf-1", name: "Scan", mimeType: "application/pdf" },
        ],
        [{ id: "sheet-1", name: "Budget", mimeType: SHEET }],
      ],
      sub: [[{ id: "slides-1", name: "Deck", mimeType: SLIDES }]],
    });

    await expect(listDriveFolderSourceFiles(["root"], "token")).resolves.toEqual({
      files: [
        { id: "doc-1", name: "Minutes", mimeType: DOC },
        { id: "sheet-1", name: "Budget", mimeType: SHEET },
        { id: "slides-1", name: "Deck", mimeType: SLIDES },
      ],
      truncated: false,
    });
  });

  it("resolves file shortcuts, skips folder shortcuts, and dedupes", async () => {
    const fetch = stubDrive({
      root: [
        [
          { id: "doc-1", name: "Minutes", mimeType: DOC },
          {
            id: "short-1",
            name: "Minutes (link)",
            mimeType: "application/vnd.google-apps.shortcut",
            shortcutDetails: { targetId: "doc-1", targetMimeType: DOC },
          },
          {
            id: "short-2",
            name: "Elsewhere",
            mimeType: "application/vnd.google-apps.shortcut",
            shortcutDetails: { targetId: "doc-2", targetMimeType: DOC },
          },
          {
            id: "short-3",
            name: "Folder link",
            mimeType: "application/vnd.google-apps.shortcut",
            shortcutDetails: { targetId: "root", targetMimeType: DRIVE_FOLDER_MIME },
          },
        ],
      ],
    });

    const listing = await listDriveFolderSourceFiles(["root", "root"], "token");
    expect(listing.files.map((file) => file.id)).toEqual(["doc-1", "doc-2"]);
    expect(listing.files[1]).toEqual({ id: "doc-2", name: "Elsewhere", mimeType: DOC });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reports truncation instead of listing without bound", async () => {
    const many = Array.from({ length: MAX_FOLDER_FILES + 5 }, (_, i) => ({
      id: `doc-${i}`,
      mimeType: DOC,
    }));
    stubDrive({ root: [many] });

    const listing = await listDriveFolderSourceFiles(["root"], "token");
    expect(listing.truncated).toBe(true);
    expect(listing.files).toHaveLength(MAX_FOLDER_FILES);
  });

  it("throws when Drive refuses the folder", async () => {
    stubDrive({});
    await expect(listDriveFolderSourceFiles(["missing"], "token")).rejects.toThrow("(404)");
  });
});

describe("isDriveFolderId", () => {
  it("accepts Drive ids and rejects anything that could break the query", () => {
    expect(isDriveFolderId("1AbC_def-ghiJKLmnop")).toBe(true);
    expect(isDriveFolderId("abc' or '1'='1")).toBe(false);
    expect(isDriveFolderId("short")).toBe(false);
    expect(isDriveFolderId(42)).toBe(false);
  });
});
