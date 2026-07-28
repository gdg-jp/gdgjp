import { requireSnsAccess } from "~/lib/access.server";
import { getPost, listPostMedia } from "~/lib/db.server";
import { claimAndPublish } from "~/lib/publish.server";
import { MAX_IMAGES, MAX_IMAGE_BYTES, nowIso } from "~/lib/utils";
import type { Route } from "./+types/api.posts";
export async function action({ request, context }: Route.ActionArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  const form = await request.formData();
  const postId = String(form.get("postId") ?? "");
  const post = await getPost(context.cloudflare.env.DB, postId);
  if (!post || post.chapterId !== access.chapter.chapterId)
    throw new Response("Not found", { status: 404 });
  if (form.get("intent") === "publish") {
    await claimAndPublish(context.cloudflare.env, postId);
    return Response.json({ ok: true });
  }

  if (form.get("intent") === "add_media") {
    if (["published", "posting"].includes(post.status))
      return Response.json(
        { error: "投稿中または投稿済みの投稿には画像を追加できません。" },
        { status: 409 },
      );

    const files = form
      .getAll("images")
      .filter((value): value is File => value instanceof File && value.size > 0);
    const existingMedia =
      (await listPostMedia(context.cloudflare.env.DB, [post.id]))[post.id] ?? [];
    if (
      files.length === 0 ||
      existingMedia.length + files.length > MAX_IMAGES ||
      files.some((file) => file.size > MAX_IMAGE_BYTES || !file.type.startsWith("image/"))
    ) {
      return Response.json(
        { error: "画像は4枚まで、1枚5MB以下の画像ファイルを指定してください。" },
        { status: 400 },
      );
    }

    for (const [index, file] of files.entries()) {
      const key = `${post.chapterId}/${post.id}/${crypto.randomUUID()}`;
      await context.cloudflare.env.MEDIA.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
      });
      await context.cloudflare.env.DB.prepare(
        "INSERT INTO post_media (id, post_id, r2_key, content_type, byte_size, alt_text, sort_order, created_at) VALUES (?, ?, ?, ?, ?, '', ?, ?)",
      )
        .bind(
          crypto.randomUUID(),
          post.id,
          key,
          file.type,
          file.size,
          existingMedia.length + index,
          nowIso(),
        )
        .run();
    }
    await claimAndPublish(context.cloudflare.env, post.id);
    return Response.json({ ok: true });
  }

  throw new Response("Bad request", { status: 400 });
}
