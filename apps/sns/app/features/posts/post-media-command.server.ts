import { requireSnsAccess } from "~/features/auth/access.server";
import { MAX_IMAGES, MAX_IMAGE_BYTES } from "~/features/posts/media-policy";
import { postDraftDepsFromEnv } from "~/features/posts/post-draft.deps.server";
import { PostDraftError, attachMedia } from "~/features/posts/post-draft.service.server";
import { listPostMedia } from "~/features/posts/post-media.repository.server";
import { getPost } from "~/features/posts/post.repository.server";
import { claimAndPublish } from "~/features/posts/scheduled-publishing.server";

const MEDIA_ERROR = "画像は4枚まで、1枚5MB以下の画像ファイルを指定してください。";
const LOCKED_ERROR = "投稿中または投稿済みの投稿には画像を追加できません。";

export async function updatePostMedia(request: Request, env: Env) {
  const access = await requireSnsAccess(env, request);
  const form = await request.formData();
  const postId = String(form.get("postId") ?? "");
  const post = await getPost(env.DB, postId);
  if (!post || post.chapterId !== access.chapter.chapterId)
    throw new Response("Not found", { status: 404 });
  if (form.get("intent") === "publish") {
    await claimAndPublish(env, postId);
    return Response.json({ ok: true });
  }

  if (form.get("intent") === "add_media") {
    if (["published", "posting"].includes(post.status))
      return Response.json({ error: LOCKED_ERROR }, { status: 409 });

    const files = form
      .getAll("images")
      .filter((value): value is File => value instanceof File && value.size > 0);
    const existingMedia = (await listPostMedia(env.DB, [post.id]))[post.id] ?? [];
    if (
      files.length === 0 ||
      existingMedia.length + files.length > MAX_IMAGES ||
      files.some((file) => file.size > MAX_IMAGE_BYTES || !file.type.startsWith("image/"))
    ) {
      return Response.json({ error: MEDIA_ERROR }, { status: 400 });
    }

    const deps = postDraftDepsFromEnv(env);
    try {
      for (const [index, file] of files.entries()) {
        await attachMedia(deps, post.id, {
          bytes: await file.arrayBuffer(),
          contentType: file.type,
          sortOrder: existingMedia.length + index,
        });
      }
    } catch (error) {
      if (error instanceof PostDraftError) {
        if (error.code === "not_editable")
          return Response.json({ error: LOCKED_ERROR }, { status: 409 });
        if (["too_many_images", "image_too_large", "not_image"].includes(error.code))
          return Response.json({ error: MEDIA_ERROR }, { status: 400 });
      }
      throw error;
    }
    await claimAndPublish(env, post.id);
    return Response.json({ ok: true });
  }

  throw new Response("Bad request", { status: 400 });
}
