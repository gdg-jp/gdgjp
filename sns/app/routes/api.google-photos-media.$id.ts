import { requireSnsAccess } from "~/lib/access.server";
import type { Route } from "./+types/api.google-photos-media.$id";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  const media = await context.cloudflare.env.DB.prepare(
    `SELECT m.r2_key, m.content_type FROM google_photos_media m
     JOIN google_photos_albums a ON a.id = m.album_id
     WHERE m.id = ? AND a.chapter_id = ?`,
  )
    .bind(params.id, access.chapter.chapterId)
    .first<{ r2_key: string; content_type: string }>();
  if (!media) throw new Response("Not found", { status: 404 });
  const object = await context.cloudflare.env.MEDIA.get(media.r2_key);
  if (!object) throw new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: { "Content-Type": media.content_type, "Cache-Control": "private, max-age=3600" },
  });
}
