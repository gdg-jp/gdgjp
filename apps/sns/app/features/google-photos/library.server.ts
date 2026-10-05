import { data, redirect } from "react-router";
import { requireSnsAccess } from "~/features/auth/access.server";
import { listGooglePhotosLibraryMedia } from "~/features/google-photos/google-photos.repository.server";
import { MAX_IMAGES } from "~/features/posts/media-policy";
import { postDraftDepsFromEnv } from "~/features/posts/post-draft.deps.server";
import { PostDraftError, attachMedia } from "~/features/posts/post-draft.service.server";
import { listPostMedia } from "~/features/posts/post-media.repository.server";
import { getPost } from "~/features/posts/post.repository.server";
import { claimAndPublish } from "~/features/posts/scheduled-publishing.server";

export async function loadPhotoLibrary(request: Request, env: Env) {
  const access = await requireSnsAccess(env, request);
  const postId = new URL(request.url).searchParams.get("postId");
  const post = postId ? await getPost(env.DB, postId) : null;
  if (!post || post.chapterId !== access.chapter.chapterId)
    throw new Response("Not found", { status: 404 });
  const cursor = new URL(request.url).searchParams.get("cursor");
  const library = await listGooglePhotosLibraryMedia(env.DB, access.chapter.chapterId, {
    cursor,
  });
  return {
    ...access,
    post,
    ...library,
    remaining: MAX_IMAGES - ((await listPostMedia(env.DB, [post.id]))[post.id] ?? []).length,
  };
}

export async function attachLibraryPhotos(request: Request, env: Env) {
  const access = await requireSnsAccess(env, request);
  const form = await request.formData();
  const postId = String(form.get("postId") ?? "");
  const post = await getPost(env.DB, postId);
  if (!post || post.chapterId !== access.chapter.chapterId)
    throw new Response("Not found", { status: 404 });
  if (["published", "posting"].includes(post.status))
    return data({ error: "投稿済みの投稿には画像を追加できません。" }, { status: 409 });
  const selectedIds = [...new Set(form.getAll("mediaId").map(String))];
  const existing = (await listPostMedia(env.DB, [post.id]))[post.id] ?? [];
  if (!selectedIds.length || selectedIds.length > MAX_IMAGES - existing.length)
    return data({ error: "選択できる画像数を確認してください。" }, { status: 400 });
  const placeholders = selectedIds.map(() => "?").join(",");
  const selected = await env.DB.prepare(
    `SELECT m.id, m.r2_key, m.content_type, m.byte_size
     FROM google_photos_media m JOIN google_photos_albums a ON a.id = m.album_id
     WHERE a.chapter_id = ? AND m.id IN (${placeholders})`,
  )
    .bind(access.chapter.chapterId, ...selectedIds)
    .all<{ id: string; r2_key: string; content_type: string; byte_size: number }>();
  if (selected.results.length !== selectedIds.length)
    return data({ error: "選択した画像が見つかりません。" }, { status: 404 });
  const deps = postDraftDepsFromEnv(env);
  for (const [index, item] of selected.results.entries()) {
    const source = await env.MEDIA.get(item.r2_key);
    if (!source) return data({ error: "保存済み画像が見つかりません。" }, { status: 409 });
    try {
      await attachMedia(deps, post.id, {
        bytes: await source.arrayBuffer(),
        contentType: item.content_type,
        sortOrder: existing.length + index,
      });
    } catch (error) {
      if (error instanceof PostDraftError && error.code === "not_editable")
        return data({ error: "投稿済みの投稿には画像を追加できません。" }, { status: 409 });
      throw error;
    }
  }
  await claimAndPublish(env, post.id);
  throw redirect(`/schedule?edit=${post.id}`);
}
