import {
  nextGooglePhotosPollAt,
  nextGooglePhotosPollState,
} from "../app/lib/google-photos-polling";
import { MAX_IMAGE_BYTES, nowIso } from "../app/lib/utils";

export type ClaimedGooglePhotosAlbum = { id: string; url: string; runId: string };
type DueGooglePhotosAlbum = { id: string; album_url: string };
type CompletePayload = {
  albumId: string;
  runId: string;
  outcome: "imported" | "unchanged" | "failed" | "structure_changed";
  discoveredPhotoIds?: string[];
  importedCount?: number;
  duplicateCount?: number;
  detail?: string;
};

const KNOWN_MEDIA_QUERY_CHUNK_SIZE = 50;
// The GitHub workflow can run for 15 minutes, and its runner setup happens after this claim.
const GOOGLE_PHOTOS_IMPORT_LEASE_MS = 20 * 60_000;

function isValidBlurhash(value: string | null): value is string {
  return value !== null && value.length >= 6 && value.length <= 200 && !/\s/.test(value);
}

export function googlePhotosKnownMediaChunks(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += KNOWN_MEDIA_QUERY_CHUNK_SIZE)
    chunks.push(ids.slice(index, index + KNOWN_MEDIA_QUERY_CHUNK_SIZE));
  return chunks;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

export async function claimDueGooglePhotosAlbum(
  env: Env,
  now = nowIso(),
): Promise<ClaimedGooglePhotosAlbum | null> {
  const album = await env.DB.prepare(
    `SELECT id, album_url FROM google_photos_albums
     WHERE enabled = 1 AND next_poll_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)
     ORDER BY next_poll_at LIMIT 1`,
  )
    .bind(now, now)
    .first<DueGooglePhotosAlbum>();
  if (!album) return null;
  const lease = new Date(Date.now() + GOOGLE_PHOTOS_IMPORT_LEASE_MS).toISOString();
  const runId = crypto.randomUUID();
  const claimed = await env.DB.prepare(
    "UPDATE google_photos_albums SET lease_expires_at = ?, active_run_id = ?, updated_at = ? WHERE id = ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)",
  )
    .bind(lease, runId, now, album.id, now)
    .run();
  if (claimed.meta.changes !== 1) return null;
  await env.DB.prepare(
    "INSERT INTO google_photos_poll_runs (id, album_id, started_at, outcome) VALUES (?, ?, ?, 'running')",
  )
    .bind(runId, album.id, now)
    .run();
  return { id: album.id, url: album.album_url, runId };
}

async function claimAlbum(env: Env): Promise<Response> {
  const album = await claimDueGooglePhotosAlbum(env);
  return json({ album });
}

async function storeMedia(request: Request, env: Env): Promise<Response> {
  const albumId = request.headers.get("x-album-id");
  const stablePhotoId = request.headers.get("x-stable-photo-id");
  const runId = request.headers.get("x-import-run-id");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0] ?? "";
  const sourceUrl = request.headers.get("x-source-url");
  const blurhash = request.headers.get("x-blurhash");
  const takenAtHeader = request.headers.get("x-photo-taken-at");
  const takenAt =
    takenAtHeader && !Number.isNaN(Date.parse(takenAtHeader))
      ? new Date(takenAtHeader).toISOString()
      : null;
  if (!albumId || !stablePhotoId || !runId || !request.body || !contentType.startsWith("image/"))
    return json({ error: "invalid media upload" }, 400);
  const album = await env.DB.prepare(
    "SELECT chapter_id FROM google_photos_albums WHERE id = ? AND active_run_id = ? AND lease_expires_at > ?",
  )
    .bind(albumId, runId, nowIso())
    .first<{ chapter_id: number }>();
  if (!album) return json({ error: "album lease expired" }, 409);
  const existing = await env.DB.prepare(
    "SELECT id, blurhash FROM google_photos_media WHERE album_id = ? AND stable_photo_id = ?",
  )
    .bind(albumId, stablePhotoId)
    .first<{ id: string; blurhash: string | null }>();
  if (existing) {
    if (!existing.blurhash && isValidBlurhash(blurhash))
      await env.DB.prepare("UPDATE google_photos_media SET blurhash = ? WHERE id = ?")
        .bind(blurhash, existing.id)
        .run();
    return json({ duplicate: true }, 409);
  }
  if (!isValidBlurhash(blurhash)) return json({ error: "invalid blurhash" }, 400);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) return json({ error: "image exceeds 5 MB" }, 413);
  const id = crypto.randomUUID();
  const key = `google-photos/${album.chapter_id}/${id}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType } });
  try {
    await env.DB.prepare(
      `INSERT INTO google_photos_media
       (id, album_id, stable_photo_id, r2_key, content_type, byte_size, source_url, blurhash, taken_at, imported_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        albumId,
        stablePhotoId,
        key,
        contentType,
        bytes.byteLength,
        sourceUrl,
        blurhash,
        takenAt,
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
  const payload = (await request.json()) as {
    albumId?: string;
    runId?: string;
    stablePhotoIds?: string[];
    media?: { stablePhotoId?: string; takenAt?: string | null }[];
  };
  const media = payload.media ?? [];
  const ids = [
    ...new Set([...media.map((item) => item.stablePhotoId), ...(payload.stablePhotoIds ?? [])]),
  ].filter((id): id is string => typeof id === "string");
  if (!payload.albumId || !payload.runId || ids.length === 0) return json({ known: [] });
  const activeRun = await env.DB.prepare(
    "SELECT id FROM google_photos_albums WHERE id = ? AND active_run_id = ? AND lease_expires_at > ?",
  )
    .bind(payload.albumId, payload.runId, nowIso())
    .first<{ id: string }>();
  if (!activeRun) return json({ error: "album lease expired" }, 409);
  const takenAtById = new Map(
    media.flatMap((item) => {
      if (!item.stablePhotoId || !item.takenAt || Number.isNaN(Date.parse(item.takenAt))) return [];
      return [[item.stablePhotoId, new Date(item.takenAt).toISOString()] as const];
    }),
  );
  if (takenAtById.size) {
    await env.DB.batch(
      [...takenAtById].map(([id, takenAt]) =>
        env.DB.prepare(
          "UPDATE google_photos_media SET taken_at = ? WHERE album_id = ? AND stable_photo_id = ? AND taken_at IS NULL",
        ).bind(takenAt, payload.albumId, id),
      ),
    );
  }
  // A shared album can contain more IDs than D1 accepts in one bound IN clause.
  // Query in small chunks so large albums do not fail before importing media.
  const known = new Set<string>();
  for (const idChunk of googlePhotosKnownMediaChunks(ids)) {
    const placeholders = idChunk.map(() => "?").join(",");
    const result = await env.DB.prepare(
      `SELECT stable_photo_id, blurhash FROM google_photos_media
       WHERE album_id = ? AND stable_photo_id IN (${placeholders})`,
    )
      .bind(payload.albumId, ...idChunk)
      .all<{ stable_photo_id: string; blurhash: string | null }>();
    for (const row of result.results) if (row.blurhash) known.add(row.stable_photo_id);
  }
  return json({ known: [...known] });
}

async function completeAlbum(request: Request, env: Env): Promise<Response> {
  const payload = (await request.json()) as CompletePayload;
  const album = await env.DB.prepare(
    "SELECT poll_interval_minutes, unchanged_poll_count FROM google_photos_albums WHERE id = ? AND active_run_id = ? AND lease_expires_at > ?",
  )
    .bind(payload.albumId, payload.runId, nowIso())
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
    const resetSnapshots = [
      env.DB.prepare("DELETE FROM google_photos_snapshot_items WHERE album_id = ?").bind(
        payload.albumId,
      ),
    ];
    const completed = await env.DB.prepare(
      `UPDATE google_photos_albums SET poll_interval_minutes = ?, unchanged_poll_count = ?, next_poll_at = ?,
       last_success_at = ?, last_error = NULL, lease_expires_at = NULL, active_run_id = NULL, updated_at = ?
       WHERE id = ? AND active_run_id = ?`,
    )
      .bind(
        next.intervalMinutes,
        next.unchangedPollCount,
        nextGooglePhotosPollAt(next.intervalMinutes),
        now,
        now,
        payload.albumId,
        payload.runId,
      )
      .run();
    if (completed.meta.changes !== 1) return json({ error: "album lease expired" }, 409);
    const statements: D1PreparedStatement[] = resetSnapshots;
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
      "UPDATE google_photos_albums SET next_poll_at = ?, last_error = ?, lease_expires_at = NULL, active_run_id = NULL, updated_at = ? WHERE id = ? AND active_run_id = ?",
    )
      .bind(
        nextGooglePhotosPollAt(Math.min(album.poll_interval_minutes, 5)),
        payload.detail ?? payload.outcome,
        now,
        payload.albumId,
        payload.runId,
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
