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
      nextGooglePhotosPollAt(5),
      now,
      now,
    )
    .run();
  throw redirect("/settings");
}
