/**
 * Recursive Drive folder listing for the add-source panel: a picked folder expands into every
 * Google Docs / Sheets / Slides file beneath it (sub-folders included), each staged as its own
 * source. Shortcuts to those files count as the file they point to; shortcuts to folders are not
 * followed (they can loop back to an ancestor).
 */
import { fetchWithTimeout } from "./drive-fetch.server";

export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
const SOURCE_FILE_MIMES = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.spreadsheet",
]);

/** Upper bound on files returned for one listing; more than this is reported as truncated. */
export const MAX_FOLDER_FILES = 1000;
/** Upper bound on folders visited (one listing request each, plus paging). */
export const MAX_FOLDER_VISITS = 200;
const LIST_TIMEOUT_MS = 15_000;

export type DriveFolderFile = { id: string; name: string; mimeType: string };
export type DriveFolderListing = { files: DriveFolderFile[]; truncated: boolean };

type DriveListResponse = {
  nextPageToken?: string;
  files?: Array<{
    id?: string;
    name?: string;
    mimeType?: string;
    shortcutDetails?: { targetId?: string; targetMimeType?: string };
  }>;
};

const FOLDER_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

export function isDriveFolderId(value: unknown): value is string {
  return typeof value === "string" && FOLDER_ID_RE.test(value);
}

function childrenUrl(folderId: string, pageToken?: string): string {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "nextPageToken,files(id,name,mimeType,shortcutDetails(targetId,targetMimeType))",
    pageSize: "1000",
    orderBy: "folder,name_natural",
    // Without both flags Drive lists nothing inside a shared drive, where this org keeps content.
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  if (pageToken) params.set("pageToken", pageToken);
  return `https://www.googleapis.com/drive/v3/files?${params}`;
}

/**
 * List every Docs / Sheets / Slides file under the given folders, breadth-first, deduplicated by
 * file id. Throws on a Drive API error so the caller can tell "no access" from "empty folder".
 */
export async function listDriveFolderSourceFiles(
  folderIds: readonly string[],
  accessToken: string,
): Promise<DriveFolderListing> {
  const queue = [...new Set(folderIds)];
  const visited = new Set<string>(queue);
  const seenFiles = new Set<string>();
  const files: DriveFolderFile[] = [];
  let visits = 0;

  while (queue.length > 0) {
    const folderId = queue.shift() as string;
    if (visits >= MAX_FOLDER_VISITS) return { files, truncated: true };
    visits += 1;
    let pageToken: string | undefined;
    do {
      const response = await fetchWithTimeout(
        childrenUrl(folderId, pageToken),
        { headers: { Authorization: `Bearer ${accessToken}` } },
        LIST_TIMEOUT_MS,
      );
      if (!response.ok) {
        throw new Error(`Google Drive folder listing failed (${response.status})`);
      }
      const body = (await response.json()) as DriveListResponse;
      for (const item of body.files ?? []) {
        if (!item.id) continue;
        if (item.mimeType === DRIVE_FOLDER_MIME) {
          if (!visited.has(item.id)) {
            visited.add(item.id);
            queue.push(item.id);
          }
          continue;
        }
        const target =
          item.mimeType === DRIVE_SHORTCUT_MIME
            ? { id: item.shortcutDetails?.targetId, mimeType: item.shortcutDetails?.targetMimeType }
            : { id: item.id, mimeType: item.mimeType };
        if (!target.id || !target.mimeType || !SOURCE_FILE_MIMES.has(target.mimeType)) continue;
        if (seenFiles.has(target.id)) continue;
        if (files.length >= MAX_FOLDER_FILES) return { files, truncated: true };
        seenFiles.add(target.id);
        files.push({ id: target.id, name: item.name ?? target.id, mimeType: target.mimeType });
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
  }
  return { files, truncated: false };
}
