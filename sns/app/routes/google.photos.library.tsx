import { Form, data, redirect } from "react-router";
import { AppShell } from "~/components/app-shell";
import { requireSnsAccess } from "~/lib/access.server";
import { getPost, listGooglePhotosLibraryMedia, listPostMedia } from "~/lib/db.server";
import { claimAndPublish } from "~/lib/publish.server";
import { MAX_IMAGES, nowIso } from "~/lib/utils";
import type { Route } from "./+types/google.photos.library";

export async function loader({ request, context }: Route.LoaderArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  const postId = new URL(request.url).searchParams.get("postId");
  const post = postId ? await getPost(context.cloudflare.env.DB, postId) : null;
  if (!post || post.chapterId !== access.chapter.chapterId)
    throw new Response("Not found", { status: 404 });
  return {
    ...access,
    post,
    media: await listGooglePhotosLibraryMedia(context.cloudflare.env.DB, access.chapter.chapterId),
    remaining:
      MAX_IMAGES -
      ((await listPostMedia(context.cloudflare.env.DB, [post.id]))[post.id] ?? []).length,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
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
  for (const [index, item] of selected.results.entries()) {
    const source = await env.MEDIA.get(item.r2_key);
    if (!source) return data({ error: "保存済み画像が見つかりません。" }, { status: 409 });
    const key = `${post.chapterId}/${post.id}/${crypto.randomUUID()}`;
    await env.MEDIA.put(key, source.body, { httpMetadata: { contentType: item.content_type } });
    await env.DB.prepare(
      "INSERT INTO post_media (id, post_id, r2_key, content_type, byte_size, alt_text, sort_order, created_at) VALUES (?, ?, ?, ?, ?, '', ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        post.id,
        key,
        item.content_type,
        item.byte_size,
        existing.length + index,
        nowIso(),
      )
      .run();
  }
  await claimAndPublish(env, post.id);
  throw redirect(`/schedule?edit=${post.id}`);
}

export default function GooglePhotosLibrary({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <AppShell user={loaderData.user} chapter={loaderData.chapter} chapters={loaderData.chapters}>
      <Form method="post" className="space-y-4 p-4">
        <input type="hidden" name="postId" value={loaderData.post.id} />
        <h1 className="text-xl font-bold">Google Photos の写真</h1>
        <p className="text-sm text-muted-foreground">
          最大 {loaderData.remaining} 枚選択できます。
        </p>
        {actionData?.error ? <p className="text-sm text-red-500">{actionData.error}</p> : null}
        {loaderData.media.length ? (
          <div className="grid grid-cols-3 gap-2">
            {loaderData.media.map((item) => (
              <label key={item.id} className="relative cursor-pointer rounded-xl border p-2">
                <img
                  src={`/api/google-photos-media/${item.id}`}
                  alt=""
                  className="aspect-square w-full rounded-lg object-cover"
                />
                <input name="mediaId" value={item.id} type="checkbox" className="mt-2" />
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">まだ取り込まれた写真はありません。</p>
        )}
        <button
          disabled={!loaderData.remaining || !loaderData.media.length}
          className="w-full rounded-full bg-primary px-5 py-3 font-bold text-white disabled:opacity-50"
          type="submit"
        >
          選択した写真を追加
        </button>
      </Form>
    </AppShell>
  );
}
