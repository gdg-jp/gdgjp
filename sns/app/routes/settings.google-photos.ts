import { data, redirect } from "react-router";
import { requireSnsAccess } from "~/lib/access.server";
import { nextGooglePhotosPollAt } from "~/lib/google-photos-polling";
import { nowIso } from "~/lib/utils";
import type { Route } from "./+types/settings.google-photos";

function publicAlbumUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.endsWith("photos.google.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const R2_DELETE_BATCH_SIZE = 1_000;

async function deleteMediaObjects(keys: string[], media: R2Bucket): Promise<void> {
  for (let index = 0; index < keys.length; index += R2_DELETE_BATCH_SIZE)
    await media.delete(keys.slice(index, index + R2_DELETE_BATCH_SIZE));
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireSnsAccess(env, request);
  if (access.chapter.role !== "organizer") throw new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");
  const now = nowIso();
  if (intent === "disable") {
    await env.DB.prepare(
      "UPDATE google_photos_albums SET enabled = 0, updated_at = ? WHERE chapter_id = ?",
    )
      .bind(now, access.chapter.chapterId)
      .run();
    throw redirect("/settings");
  }
  const albumUrl = publicAlbumUrl(String(form.get("albumUrl") ?? "").trim());
  if (!albumUrl)
    return data(
      { error: "公開 Google Photos アルバムの HTTPS URL を入力してください。" },
      { status: 400 },
    );
  const existing = await env.DB.prepare(
    "SELECT id, album_url FROM google_photos_albums WHERE chapter_id = ?",
  )
    .bind(access.chapter.chapterId)
    .first<{ id: string; album_url: string }>();
  const albumChanged = Boolean(existing && existing.album_url !== albumUrl);
  if (existing && albumChanged) {
    // Stop an in-flight import before removing its media. The run-scoped lease prevents it
    // from adding old-album photos back after this reset.
    await env.DB.prepare(
      "UPDATE google_photos_albums SET enabled = 0, lease_expires_at = NULL, active_run_id = NULL, updated_at = ? WHERE id = ?",
    )
      .bind(now, existing.id)
      .run();
    const media = await env.DB.prepare("SELECT r2_key FROM google_photos_media WHERE album_id = ?")
      .bind(existing.id)
      .all<{ r2_key: string }>();
    try {
      await deleteMediaObjects(
        media.results.map((item) => item.r2_key),
        env.MEDIA,
      );
    } catch (error) {
      await env.DB.prepare(
        "UPDATE google_photos_albums SET enabled = 1, updated_at = ? WHERE id = ? AND album_url = ?",
      )
        .bind(nowIso(), existing.id, existing.album_url)
        .run();
      throw error;
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM google_photos_media WHERE album_id = ?").bind(existing.id),
      env.DB.prepare("DELETE FROM google_photos_snapshot_items WHERE album_id = ?").bind(
        existing.id,
      ),
    ]);
  }
  await env.DB.prepare(
    `INSERT INTO google_photos_albums
       (id, chapter_id, album_url, enabled, poll_interval_minutes, unchanged_poll_count, next_poll_at, created_at, updated_at)
     VALUES (?, ?, ?, 1, 5, 0, ?, ?, ?)
     ON CONFLICT(chapter_id) DO UPDATE SET
       album_url = excluded.album_url, enabled = 1, poll_interval_minutes = 5,
       unchanged_poll_count = 0, next_poll_at = excluded.next_poll_at, last_error = NULL,
       updated_at = excluded.updated_at`,
  )
    .bind(
      crypto.randomUUID(),
      access.chapter.chapterId,
      albumUrl,
      albumChanged ? now : nextGooglePhotosPollAt(5),
      now,
      now,
    )
    .run();
  throw redirect("/settings");
}
