export type FolderRow = {
  id: number;
  chapterId: number;
  name: string;
  createdByUserId: string;
  createdAt: number;
  updatedAt: number;
};

export type FolderWithCount = FolderRow & { imageCount: number };

type FolderDbRow = {
  id: number;
  chapter_id: number;
  name: string;
  created_by_user_id: string;
  created_at: number;
  updated_at: number;
};

type FolderWithCountDbRow = FolderDbRow & { image_count: number };

function toFolderRow(row: FolderDbRow): FolderRow {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    name: row.name,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS = "id, chapter_id, name, created_by_user_id, created_at, updated_at";

export async function getFolder(db: D1Database, id: number): Promise<FolderRow | null> {
  const row = await db
    .prepare(`SELECT ${SELECT_COLS} FROM folders WHERE id = ?`)
    .bind(id)
    .first<FolderDbRow>();
  return row ? toFolderRow(row) : null;
}

export type FolderListCursor = { name: string; id: number };

export type ListFoldersOptions = {
  /** Narrows to one explicit chapter (still subject to the caller's access). */
  chapterId?: number;
  limit?: number;
  cursor?: FolderListCursor | null;
};

export type ListFoldersResult = {
  folders: FolderWithCount[];
  nextCursor: string | null;
};

/**
 * Parses an opaque folder-list cursor, mirroring parseImageListCursor in
 * ../images/repository.ts: undefined means malformed, distinct from the
 * "no cursor" case (null).
 */
export function parseFolderListCursor(cursor: string): FolderListCursor | undefined {
  try {
    const value = JSON.parse(cursor) as { name?: unknown; id?: unknown };
    return typeof value.name === "string" && typeof value.id === "number"
      ? { name: value.name, id: value.id }
      : undefined;
  } catch {
    return undefined;
  }
}

const DEFAULT_LIST_LIMIT = 100;

/**
 * Lists folders in any of the given chapters, with the count of images
 * currently assigned to each. Since folders are chapter-owned and images can
 * only be assigned to a folder in their own chapter (see
 * setImageFolderForActor), every image counted here is also visible to a
 * viewer who can see the folder — no separate access predicate needed on the
 * count subquery (contrast tinyurl's LINK_ACCESS_SQL).
 */
export async function listFoldersForChapters(
  db: D1Database,
  chapterIds: number[],
  options: ListFoldersOptions = {},
): Promise<ListFoldersResult> {
  if (chapterIds.length === 0) return { folders: [], nextCursor: null };
  const limit = options.limit ?? DEFAULT_LIST_LIMIT;
  const cursor = options.cursor ?? null;

  const conditions = ["f.chapter_id IN (SELECT value FROM json_each(?))"];
  const params: unknown[] = [JSON.stringify(chapterIds)];
  if (options.chapterId !== undefined) {
    conditions.push("f.chapter_id = ?");
    params.push(options.chapterId);
  }
  if (cursor) {
    conditions.push("(f.name > ? OR (f.name = ? AND f.id > ?))");
    params.push(cursor.name, cursor.name, cursor.id);
  }

  const { results } = await db
    .prepare(
      `SELECT ${SELECT_COLS}, (SELECT COUNT(*) FROM images i WHERE i.folder_id = f.id) AS image_count
       FROM folders f
       WHERE ${conditions.join(" AND ")}
       ORDER BY f.name, f.id
       LIMIT ?`,
    )
    .bind(...params, limit + 1)
    .all<FolderWithCountDbRow>();

  const rows = results.slice(0, limit);
  const last = rows.at(-1);
  return {
    folders: rows.map((row) => ({ ...toFolderRow(row), imageCount: row.image_count })),
    nextCursor:
      results.length > limit && last ? JSON.stringify({ name: last.name, id: last.id }) : null,
  };
}

export type CreateFolderResult =
  | { ok: true; folder: FolderRow }
  | { ok: false; reason: "name_taken" };

export async function createFolder(
  db: D1Database,
  input: { chapterId: number; name: string; createdByUserId: string },
): Promise<CreateFolderResult> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO folders (chapter_id, name, created_by_user_id)
         VALUES (?, ?, ?)
         RETURNING ${SELECT_COLS}`,
      )
      .bind(input.chapterId, input.name, input.createdByUserId)
      .first<FolderDbRow>();
    if (!row) throw new Error("insert returned no row");
    return { ok: true, folder: toFolderRow(row) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE")) return { ok: false, reason: "name_taken" };
    throw err;
  }
}

export type RenameFolderResult =
  | { ok: true; folder: FolderRow }
  | { ok: false; reason: "not_found" | "name_taken" };

export async function renameFolder(
  db: D1Database,
  id: number,
  name: string,
): Promise<RenameFolderResult> {
  try {
    const row = await db
      .prepare(
        `UPDATE folders SET name = ?, updated_at = unixepoch() WHERE id = ? RETURNING ${SELECT_COLS}`,
      )
      .bind(name, id)
      .first<FolderDbRow>();
    if (!row) return { ok: false, reason: "not_found" };
    return { ok: true, folder: toFolderRow(row) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE")) return { ok: false, reason: "name_taken" };
    throw err;
  }
}

/** Images in the folder fall back to unfiled via ON DELETE SET NULL. */
export async function deleteFolder(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM folders WHERE id = ?").bind(id).run();
}
