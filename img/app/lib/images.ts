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

export async function listImagesByUser(
  db: D1Database,
  userId: string,
  limit = 60,
): Promise<ImageRow[]> {
  const { results } = await db
    .prepare(`SELECT ${SELECT_COLS} FROM images WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
    .bind(userId, limit)
    .all<ImageDbRow>();
  return results.map(toImageRow);
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
): Promise<void> {
  await db
    .prepare(
      `UPDATE images
       SET content_type = ?, byte_size = ?, width = ?, height = ?, filename = ?, updated_at = unixepoch()
       WHERE id = ?`,
    )
    .bind(patch.contentType, patch.byteSize, patch.width, patch.height, patch.filename, id)
    .run();
}

export async function setMobileImage(
  db: D1Database,
  id: string,
  mobile: { r2Key: string; contentType: string; byteSize: number; filename: string | null },
): Promise<void> {
  await db
    .prepare(
      `UPDATE images
       SET mobile_r2_key = ?, mobile_content_type = ?, mobile_byte_size = ?, mobile_filename = ?,
           mobile_updated_at = unixepoch(), updated_at = unixepoch()
       WHERE id = ?`,
    )
    .bind(mobile.r2Key, mobile.contentType, mobile.byteSize, mobile.filename, id)
    .run();
}

export async function removeMobileImage(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      `UPDATE images
       SET mobile_r2_key = NULL, mobile_content_type = NULL, mobile_byte_size = NULL,
           mobile_filename = NULL, mobile_updated_at = NULL, updated_at = unixepoch()
       WHERE id = ?`,
    )
    .bind(id)
    .run();
}

export async function deleteImage(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM images WHERE id = ?").bind(id).run();
}
