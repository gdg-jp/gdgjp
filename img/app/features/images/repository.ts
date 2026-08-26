export type ImageRow = {
  id: string;
  userId: string;
  accountId: string;
  chapterId: number;
  r2Key: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  filename: string | null;
  mobileR2Key: string | null;
  mobileContentType: string | null;
  mobileByteSize: number | null;
  mobileFilename: string | null;
  mobileUpdatedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

type ImageDbRow = {
  id: string;
  user_id: string;
  account_id: string;
  chapter_id: number;
  r2_key: string;
  content_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  filename: string | null;
  mobile_r2_key: string | null;
  mobile_content_type: string | null;
  mobile_byte_size: number | null;
  mobile_filename: string | null;
  mobile_updated_at: number | null;
  created_at: number;
  updated_at: number;
};

function toImageRow(row: ImageDbRow): ImageRow {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    chapterId: row.chapter_id,
    r2Key: row.r2_key,
    contentType: row.content_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    filename: row.filename,
    mobileR2Key: row.mobile_r2_key,
    mobileContentType: row.mobile_content_type,
    mobileByteSize: row.mobile_byte_size,
    mobileFilename: row.mobile_filename,
    mobileUpdatedAt: row.mobile_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS =
  "id, user_id, account_id, chapter_id, r2_key, content_type, byte_size, width, height, filename, mobile_r2_key, mobile_content_type, mobile_byte_size, mobile_filename, mobile_updated_at, created_at, updated_at";

export async function getImage(db: D1Database, id: string): Promise<ImageRow | null> {
  const row = await db
    .prepare(`SELECT ${SELECT_COLS} FROM images WHERE id = ?`)
    .bind(id)
    .first<ImageDbRow>();
  return row ? toImageRow(row) : null;
}

export type ImageListCursor = { createdAt: number; id: string };

export type ListImagesOptions = {
  chapterId?: number;
  limit?: number;
  cursor?: ImageListCursor | null;
};

export type ListImagesResult = {
  images: ImageRow[];
  nextCursor: string | null;
};

/**
 * Parses an opaque cursor token from a caller. Returns undefined when it is
 * malformed, distinct from the "no cursor" case (null), so callers can tell
 * "start from the beginning" apart from "this token is invalid".
 */
export function parseImageListCursor(cursor: string): ImageListCursor | undefined {
  try {
    const value = JSON.parse(cursor) as { createdAt?: unknown; id?: unknown };
    return typeof value.createdAt === "number" && typeof value.id === "string"
      ? { createdAt: value.createdAt, id: value.id }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function listImagesByUser(
  db: D1Database,
  userId: string,
  options: ListImagesOptions = {},
): Promise<ListImagesResult> {
  const limit = options.limit ?? 60;
  const cursor = options.cursor ?? null;

  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (options.chapterId !== undefined) {
    conditions.push("chapter_id = ?");
    params.push(options.chapterId);
  }
  if (cursor) {
    conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  const { results } = await db
    .prepare(
      `SELECT ${SELECT_COLS} FROM images WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...params, limit + 1)
    .all<ImageDbRow>();

  const rows = results.slice(0, limit);
  const last = rows.at(-1);
  return {
    images: rows.map(toImageRow),
    nextCursor:
      results.length > limit && last
        ? JSON.stringify({ createdAt: last.created_at, id: last.id })
        : null,
  };
}

export type CreateImageInput = {
  id: string;
  userId: string;
  accountId: string;
  chapterId: number;
  r2Key: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  filename: string | null;
};

export async function createImage(db: D1Database, input: CreateImageInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO images (id, user_id, account_id, chapter_id, r2_key, content_type, byte_size, width, height, filename)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.userId,
      input.accountId,
      input.chapterId,
      input.r2Key,
      input.contentType,
      input.byteSize,
      input.width,
      input.height,
      input.filename,
    )
    .run();
}

export async function updateImageBytes(
  db: D1Database,
  id: string,
  patch: {
    contentType: string;
    byteSize: number;
    width: number | null;
    height: number | null;
    filename: string | null;
  },
): Promise<ImageRow> {
  const row = await db
    .prepare(
      `UPDATE images
       SET content_type = ?, byte_size = ?, width = ?, height = ?, filename = ?, updated_at = unixepoch()
       WHERE id = ?
       RETURNING ${SELECT_COLS}`,
    )
    .bind(patch.contentType, patch.byteSize, patch.width, patch.height, patch.filename, id)
    .first<ImageDbRow>();
  if (!row) throw new Error(`image not found: ${id}`);
  return toImageRow(row);
}

export async function setMobileImage(
  db: D1Database,
  id: string,
  mobile: { r2Key: string; contentType: string; byteSize: number; filename: string | null },
): Promise<ImageRow> {
  const row = await db
    .prepare(
      `UPDATE images
       SET mobile_r2_key = ?, mobile_content_type = ?, mobile_byte_size = ?, mobile_filename = ?,
           mobile_updated_at = unixepoch(), updated_at = unixepoch()
       WHERE id = ?
       RETURNING ${SELECT_COLS}`,
    )
    .bind(mobile.r2Key, mobile.contentType, mobile.byteSize, mobile.filename, id)
    .first<ImageDbRow>();
  if (!row) throw new Error(`image not found: ${id}`);
  return toImageRow(row);
}

export async function removeMobileImage(db: D1Database, id: string): Promise<ImageRow> {
  const row = await db
    .prepare(
      `UPDATE images
       SET mobile_r2_key = NULL, mobile_content_type = NULL, mobile_byte_size = NULL,
           mobile_filename = NULL, mobile_updated_at = NULL, updated_at = unixepoch()
       WHERE id = ?
       RETURNING ${SELECT_COLS}`,
    )
    .bind(id)
    .first<ImageDbRow>();
  if (!row) throw new Error(`image not found: ${id}`);
  return toImageRow(row);
}

export async function deleteImage(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM images WHERE id = ?").bind(id).run();
}
