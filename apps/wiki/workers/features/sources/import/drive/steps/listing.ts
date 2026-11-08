import { googleDocsPathSegment } from "../../../google-docs-workspace";
import type { CurrentSourceImport, SourceImportTickContext } from "../../run";
import { metaGet, metaSet } from "../../run";
import {
  FOLDER_MIME,
  IMPORTABLE_FILE_MIMES,
  SHORTCUT_MIME,
  fileId,
  requireToken,
} from "../drive-import-shared";

/** Bounds on one folder source; past them the rest is left out (and logged), not failed. */
export const MAX_FOLDER_SOURCE_FILES = 2000;
export const MAX_FOLDER_SOURCE_FOLDERS = 500;

type DriveListItem = {
  id?: string;
  name?: string;
  mimeType?: string;
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
};

export function folderChildrenUrl(folderId: string, pageToken?: string | null): string {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "nextPageToken,files(id,name,mimeType,shortcutDetails(targetId,targetMimeType))",
    pageSize: "1000",
    // Stable order keeps the `(2)` suffixes of same-named siblings stable across refreshes.
    orderBy: "folder,name_natural,createdTime",
    // Without both flags Drive lists nothing inside a shared drive, where this org keeps content.
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  if (pageToken) params.set("pageToken", pageToken);
  return `https://www.googleapis.com/drive/v3/files?${params}`;
}

function count(sql: SqlStorage, table: "drive_files" | "drive_folders"): number {
  return sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
}

/** `base`, `base (2)`, … — the first one not yet taken in `column` of `table`. */
function uniquePath(
  sql: SqlStorage,
  table: "drive_files" | "drive_folders",
  column: "path_prefix" | "path",
  base: (name: string) => string,
  name: string,
): string {
  for (let occurrence = 1; ; occurrence += 1) {
    const candidate = base(occurrence === 1 ? name : `${name} (${occurrence})`);
    const taken = sql
      .exec(`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`, candidate)
      .toArray().length;
    if (!taken) return candidate;
  }
}

function warnTruncated(current: CurrentSourceImport, limit: "files" | "folders") {
  console.warn(
    JSON.stringify({
      component: "sources",
      integration: "google-drive",
      event: "folder_listing_truncated",
      sourceId: current.source.id,
      limit,
    }),
  );
}

function recordItem(
  sql: SqlStorage,
  current: CurrentSourceImport,
  parentPath: string,
  item: DriveListItem,
): void {
  if (!item.id) return;
  const join = (segment: string) => (parentPath ? `${parentPath}/${segment}` : segment);
  if (item.mimeType === FOLDER_MIME) {
    if (sql.exec("SELECT 1 FROM drive_folders WHERE folder_id = ?", item.id).toArray().length) {
      return;
    }
    if (count(sql, "drive_folders") >= MAX_FOLDER_SOURCE_FOLDERS) {
      warnTruncated(current, "folders");
      return;
    }
    const segment = googleDocsPathSegment(item.name ?? "", item.id);
    const path = uniquePath(sql, "drive_folders", "path", join, segment);
    sql.exec("INSERT INTO drive_folders (folder_id, path) VALUES (?, ?)", item.id, path);
    return;
  }
  // A shortcut counts as the file it points to. Shortcuts to folders are not followed: they can
  // point back at an ancestor, and the folder they name is a source of its own if it matters.
  const target =
    item.mimeType === SHORTCUT_MIME
      ? { id: item.shortcutDetails?.targetId, mimeType: item.shortcutDetails?.targetMimeType }
      : { id: item.id, mimeType: item.mimeType };
  if (!target.id || !target.mimeType || !IMPORTABLE_FILE_MIMES.has(target.mimeType)) return;
  if (sql.exec("SELECT 1 FROM drive_files WHERE file_id = ?", target.id).toArray().length) return;
  if (count(sql, "drive_files") >= MAX_FOLDER_SOURCE_FILES) {
    warnTruncated(current, "files");
    return;
  }
  const title = item.name?.trim() || target.id;
  const segment = googleDocsPathSegment(title, target.id);
  const prefix = uniquePath(sql, "drive_files", "path_prefix", (s) => `${join(s)}/`, segment);
  sql.exec(
    "INSERT INTO drive_files (file_id, mime_type, title, path_prefix) VALUES (?, ?, ?, ?)",
    target.id,
    target.mimeType,
    title,
    prefix,
  );
}

/**
 * Folder sources only: walk the folder tree breadth-first, one Drive `files.list` page per
 * subrequest, recording every importable file with the path it will live under. Resumable —
 * the page token and the queue are object-local, and re-reading a page is idempotent.
 */
export async function stepListing(ctx: SourceImportTickContext, current: CurrentSourceImport) {
  if (metaGet(ctx.sql, "drive_mime_type") !== FOLDER_MIME) return { phaseComplete: true };
  if (metaGet(ctx.sql, "drive_listed") === "1") return { phaseComplete: true };
  ctx.sql.exec(
    "INSERT OR IGNORE INTO drive_folders (folder_id, path) VALUES (?, '')",
    fileId(current),
  );
  while (ctx.budget.canSpend(1)) {
    const folder = ctx.sql
      .exec<{ id: number; folder_id: string; path: string }>(
        "SELECT id, folder_id, path FROM drive_folders WHERE status = 'pending' ORDER BY id LIMIT 1",
      )
      .toArray()[0];
    if (!folder) {
      metaSet(ctx.sql, "drive_listed", "1");
      return { phaseComplete: true };
    }
    ctx.budget.spend(1);
    const response = await fetch(
      folderChildrenUrl(folder.folder_id, metaGet(ctx.sql, "drive_listing_page_token")),
      { headers: { Authorization: `Bearer ${requireToken(ctx)}` } },
    );
    if (!response.ok) {
      throw new Error(
        `Google Drive folder listing failed (${response.status}): ${await response.text()}`,
      );
    }
    const body = (await response.json()) as { nextPageToken?: string; files?: DriveListItem[] };
    for (const item of body.files ?? []) recordItem(ctx.sql, current, folder.path, item);
    if (body.nextPageToken) {
      metaSet(ctx.sql, "drive_listing_page_token", body.nextPageToken);
    } else {
      ctx.sql.exec("DELETE FROM meta WHERE key = 'drive_listing_page_token'");
      ctx.sql.exec("UPDATE drive_folders SET status = 'done' WHERE id = ?", folder.id);
    }
  }
  return { phaseComplete: false };
}
