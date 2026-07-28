import {
  nextGooglePhotosPollAt,
  nextGooglePhotosPollState,
} from "../app/lib/google-photos-polling";
import { MAX_IMAGE_BYTES, nowIso } from "../app/lib/utils";

type ClaimedAlbum = { id: string; album_url: string };
type CompletePayload = {
  albumId: string;
  runId: string;
  outcome: "imported" | "unchanged" | "failed" | "structure_changed";
  discoveredPhotoIds?: string[];
  importedCount?: number;
  duplicateCount?: number;
  detail?: string;
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

async function claimAlbum(env: Env): Promise<Response> {
  const now = nowIso();
  const album = await env.DB.prepare(
    `SELECT id, album_url FROM google_photos_albums
     WHERE enabled = 1 AND next_poll_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)
     ORDER BY next_poll_at LIMIT 1`,
  )
    .bind(now, now)
    .first<ClaimedAlbum>();
  if (!album) return json({ album: null });
  const lease = new Date(Date.now() + 10 * 60_000).toISOString();
  const claimed = await env.DB.prepare(
    "UPDATE google_photos_albums SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)",
  )
    .bind(lease, now, album.id, now)
    .run();
  if (claimed.meta.changes !== 1) return json({ album: null });
  const runId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO google_photos_poll_runs (id, album_id, started_at, outcome) VALUES (?, ?, ?, 'running')",
  )
    .bind(runId, album.id, now)
    .run();
  return json({ album: { id: album.id, url: album.album_url, runId } });
}

async function storeMedia(request: Request, env: Env): Promise<Response> {
  const albumId = request.headers.get("x-album-id");
  const stablePhotoId = request.headers.get("x-stable-photo-id");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0] ?? "";
  const sourceUrl = request.headers.get("x-source-url");
  if (!albumId || !stablePhotoId || !request.body || !contentType.startsWith("image/"))
    return json({ error: "invalid media upload" }, 400);
  const album = await env.DB.prepare(
    "SELECT chapter_id FROM google_photos_albums WHERE id = ? AND lease_expires_at > ?",
  )
    .bind(albumId, nowIso())
    .first<{ chapter_id: number }>();
  if (!album) return json({ error: "album lease expired" }, 409);
  const existing = await env.DB.prepare(
    "SELECT id FROM google_photos_media WHERE album_id = ? AND stable_photo_id = ?",
  )
    .bind(albumId, stablePhotoId)
    .first<{ id: string }>();
  if (existing) return json({ duplicate: true }, 409);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) return json({ error: "image exceeds 5 MB" }, 413);
  const id = crypto.randomUUID();
  const key = `google-photos/${album.chapter_id}/${id}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType } });
  try {
    await env.DB.prepare(
      `INSERT INTO google_photos_media
       (id, album_id, stable_photo_id, r2_key, content_type, byte_size, source_url, imported_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        albumId,
        stablePhotoId,
        key,
        contentType,
        bytes.byteLength,
        sourceUrl,
        nowIso(),
        nowIso(),
      )
      .run();
  } catch (error) {
    await env.MEDIA.delete(key);
    throw error;
  }
  return json({ id }, 201);
}

async function knownMedia(request: Request, env: Env): Promise<Response> {
  const payload = (await request.json()) as { albumId?: string; stablePhotoIds?: string[] };
  const ids = [...new Set((payload.stablePhotoIds ?? []).filter(Boolean))];
  if (!payload.albumId || ids.length === 0) return json({ known: [] });
  const placeholders = ids.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `SELECT stable_photo_id FROM google_photos_media
     WHERE album_id = ? AND stable_photo_id IN (${placeholders})`,
  )
    .bind(payload.albumId, ...ids)
    .all<{ stable_photo_id: string }>();
  return json({ known: result.results.map((row) => row.stable_photo_id) });
}

async function completeAlbum(request: Request, env: Env): Promise<Response> {
  const payload = (await request.json()) as CompletePayload;
  const album = await env.DB.prepare(
    "SELECT poll_interval_minutes, unchanged_poll_count FROM google_photos_albums WHERE id = ? AND lease_expires_at > ?",
  )
    .bind(payload.albumId, nowIso())
    .first<{ poll_interval_minutes: number; unchanged_poll_count: number }>();
  if (!album) return json({ error: "album lease expired" }, 409);
  const now = nowIso();
  const importedCount = payload.importedCount ?? 0;
  const success = payload.outcome === "imported" || payload.outcome === "unchanged";
  if (success) {
    const next = nextGooglePhotosPollState(
      {
        intervalMinutes: album.poll_interval_minutes,
        unchangedPollCount: album.unchanged_poll_count,
      },
      importedCount > 0,
    );
    const statements: D1PreparedStatement[] = [
      env.DB.prepare("DELETE FROM google_photos_snapshot_items WHERE album_id = ?").bind(
        payload.albumId,
      ),
      env.DB.prepare(
        `UPDATE google_photos_albums SET poll_interval_minutes = ?, unchanged_poll_count = ?, next_poll_at = ?,
         last_success_at = ?, last_error = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?`,
      ).bind(
        next.intervalMinutes,
        next.unchangedPollCount,
        nextGooglePhotosPollAt(next.intervalMinutes),
        now,
        now,
        payload.albumId,
      ),
    ];
    for (const stablePhotoId of payload.discoveredPhotoIds ?? []) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO google_photos_snapshot_items (album_id, stable_photo_id, last_seen_at) VALUES (?, ?, ?)",
        ).bind(payload.albumId, stablePhotoId, now),
      );
    }
    await env.DB.batch(statements);
  } else {
    await env.DB.prepare(
      "UPDATE google_photos_albums SET next_poll_at = ?, last_error = ?, lease_expires_at = NULL, updated_at = ? WHERE id = ?",
    )
      .bind(
        nextGooglePhotosPollAt(Math.min(album.poll_interval_minutes, 5)),
        payload.detail ?? payload.outcome,
        now,
        payload.albumId,
      )
      .run();
  }
  await env.DB.prepare(
    `UPDATE google_photos_poll_runs SET finished_at = ?, outcome = ?, discovered_count = ?, imported_count = ?,
     duplicate_count = ?, detail = ? WHERE id = ? AND album_id = ? AND outcome = 'running'`,
  )
    .bind(
      now,
      payload.outcome,
      payload.discoveredPhotoIds?.length ?? 0,
      importedCount,
      payload.duplicateCount ?? 0,
      payload.detail ?? null,
      payload.runId,
      payload.albumId,
    )
    .run();
  console.log(JSON.stringify({ message: "google photos poll complete", ...payload }));
  return json({ ok: true });
}

export function googlePhotosImportOperation(url: string): string {
  return new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
}

export async function handleGooglePhotosImport(request: Request, env: Env): Promise<Response> {
  const operation = googlePhotosImportOperation(request.url);
  if (request.method === "POST" && operation === "claim") return claimAlbum(env);
  if (request.method === "POST" && operation === "known") return knownMedia(request, env);
  if (request.method === "POST" && operation === "media") return storeMedia(request, env);
  if (request.method === "POST" && operation === "complete") return completeAlbum(request, env);
  return json({ error: "not found" }, 404);
}
