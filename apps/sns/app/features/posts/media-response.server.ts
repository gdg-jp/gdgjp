import { requireSnsAccess } from "~/features/auth/access.server";

export async function servePostMedia(request: Request, env: Env, id: string) {
  const access = await requireSnsAccess(env, request);
  const media = await env.DB.prepare(
    "SELECT m.r2_key, m.content_type FROM post_media m JOIN posts p ON p.id = m.post_id WHERE m.id = ? AND p.chapter_id = ?",
  )
    .bind(id, access.chapter.chapterId)
    .first<{ r2_key: string; content_type: string }>();
  if (!media) throw new Response("Not found", { status: 404 });
  const object = await env.MEDIA.get(media.r2_key);
  if (!object) throw new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: { "Content-Type": media.content_type, "Cache-Control": "private, max-age=3600" },
  });
}
