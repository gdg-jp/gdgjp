import type {
  GooglePhotosAlbum,
  GooglePhotosLibraryMedia,
  GooglePhotosPollRun,
} from "./google-photos.types";

type GooglePhotosAlbumRow = {
  id: string;
  chapter_id: number;
  album_url: string;
  enabled: number;
  poll_interval_minutes: number;
  unchanged_poll_count: number;
  next_poll_at: string;
  last_success_at: string | null;
  last_error: string | null;
};

function googlePhotosAlbumFromRow(row: GooglePhotosAlbumRow): GooglePhotosAlbum {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    albumUrl: row.album_url,
    enabled: row.enabled === 1,
    pollIntervalMinutes: row.poll_interval_minutes,
    unchangedPollCount: row.unchanged_poll_count,
    nextPollAt: row.next_poll_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
  };
}

export async function getGooglePhotosAlbum(
  db: D1Database,
  chapterId: number,
): Promise<GooglePhotosAlbum | null> {
  const row = await db
    .prepare("SELECT * FROM google_photos_albums WHERE chapter_id = ?")
    .bind(chapterId)
    .first<GooglePhotosAlbumRow>();
  return row ? googlePhotosAlbumFromRow(row) : null;
}

export async function listGooglePhotosLibraryMedia(
  db: D1Database,
  chapterId: number,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<{ media: GooglePhotosLibraryMedia[]; nextCursor: string | null }> {
  const limit = options.limit ?? 48;
  const cursor = options.cursor ? parseGooglePhotosLibraryCursor(options.cursor) : null;
  const cursorClause = cursor
    ? `AND (COALESCE(m.taken_at, m.imported_at) < ?
        OR (COALESCE(m.taken_at, m.imported_at) = ? AND m.id < ?))`
    : "";
  const result = await db
    .prepare(
      `SELECT m.id, m.stable_photo_id, m.blurhash, m.content_type, m.byte_size, m.taken_at, m.imported_at
       FROM google_photos_media m
       JOIN google_photos_albums a ON a.id = m.album_id
       WHERE a.chapter_id = ?
       ${cursorClause}
       ORDER BY COALESCE(m.taken_at, m.imported_at) DESC, m.id DESC
       LIMIT ?`,
    )
    .bind(chapterId, ...(cursor ? [cursor.date, cursor.date, cursor.id] : []), limit + 1)
    .all<{
      id: string;
      stable_photo_id: string;
      blurhash: string | null;
      content_type: string;
      byte_size: number;
      taken_at: string | null;
      imported_at: string;
    }>();
  const rows = result.results.slice(0, limit);
  const last = rows.at(-1);
  return {
    media: rows.map((row) => ({
      id: row.id,
      stablePhotoId: row.stable_photo_id,
      blurhash: row.blurhash,
      contentType: row.content_type,
      byteSize: row.byte_size,
      takenAt: row.taken_at,
      importedAt: row.imported_at,
    })),
    nextCursor:
      result.results.length > limit && last
        ? JSON.stringify({ date: last.taken_at ?? last.imported_at, id: last.id })
        : null,
  };
}

function parseGooglePhotosLibraryCursor(cursor: string): { date: string; id: string } | null {
  try {
    const value = JSON.parse(cursor) as { date?: unknown; id?: unknown };
    return typeof value.date === "string" && typeof value.id === "string"
      ? { date: value.date, id: value.id }
      : null;
  } catch {
    return null;
  }
}

export async function listGooglePhotosPollRuns(
  db: D1Database,
  chapterId: number,
): Promise<GooglePhotosPollRun[]> {
  const result = await db
    .prepare(
      `SELECT r.id, r.started_at, r.outcome, r.imported_count, r.detail
       FROM google_photos_poll_runs r
       JOIN google_photos_albums a ON a.id = r.album_id
       WHERE a.chapter_id = ? ORDER BY r.started_at DESC LIMIT 5`,
    )
    .bind(chapterId)
    .all<{
      id: string;
      started_at: string;
      outcome: string;
      imported_count: number;
      detail: string | null;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    startedAt: row.started_at,
    outcome: row.outcome,
    importedCount: row.imported_count,
    detail: row.detail,
  }));
}
