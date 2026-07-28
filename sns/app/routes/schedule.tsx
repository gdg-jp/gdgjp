import { ImagePlus } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { AppShell } from "~/components/app-shell";
import { requireSnsAccess } from "~/lib/access.server";
import { getPost, listPostMedia, listXAccounts } from "~/lib/db.server";
import { fetchLinkPreview } from "~/lib/link-preview.server";
import { claimAndPublish } from "~/lib/publish.server";
import { MAX_IMAGES, MAX_IMAGE_BYTES, nowIso } from "~/lib/utils";
import type { Route } from "./+types/schedule";

export async function loader({ request, context }: Route.LoaderArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  const editId = new URL(request.url).searchParams.get("edit");
  const post = editId ? await getPost(context.cloudflare.env.DB, editId) : null;
  if (post && post.chapterId !== access.chapter.chapterId)
    throw new Response("Forbidden", { status: 403 });
  return {
    ...access,
    accounts: await listXAccounts(context.cloudflare.env.DB, access.chapter.chapterId),
    post,
    media: post ? ((await listPostMedia(context.cloudflare.env.DB, [post.id]))[post.id] ?? []) : [],
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireSnsAccess(env, request);
  const form = await request.formData();
  const text = String(form.get("text") ?? "").trim();
  const xAccountId = String(form.get("xAccountId") ?? "");
  const condition = form.get("condition") === "photo_required" ? "photo_required" : "scheduled";
  const scheduledInput = String(form.get("scheduledAt") ?? "");
  const scheduledAt = new Date(`${scheduledInput}:00+09:00`);
  if (!text || text.length > 280 || !xAccountId || Number.isNaN(scheduledAt.getTime()))
    return data({ error: "本文、投稿先、予約日時を確認してください。" }, { status: 400 });
  const account = (await listXAccounts(env.DB, access.chapter.chapterId)).find(
    (item) => item.id === xAccountId,
  );
  if (!account) throw new Response("Forbidden", { status: 403 });
  const id = String(form.get("postId") ?? "") || crypto.randomUUID();
  const existing = await getPost(env.DB, id);
  if (existing && existing.chapterId !== access.chapter.chapterId)
    throw new Response("Forbidden", { status: 403 });
  if (existing?.status === "published" || existing?.status === "posting")
    return data({ error: "投稿中または投稿済みの予約は変更できません。" }, { status: 409 });
  const existingMedia = existing ? ((await listPostMedia(env.DB, [id]))[id] ?? []) : [];
  const files = form
    .getAll("images")
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (
    existingMedia.length + files.length > MAX_IMAGES ||
    files.some((file) => file.size > MAX_IMAGE_BYTES || !file.type.startsWith("image/"))
  )
    return data(
      { error: "画像は4枚まで、1枚5MB以下の画像ファイルを指定してください。" },
      { status: 400 },
    );
  const preview = await fetchLinkPreview(text).catch(() => null);
  const now = nowIso();
  const status =
    condition === "photo_required" && existingMedia.length + files.length === 0
      ? "waiting_for_photo"
      : "scheduled";
  if (existing) {
    await env.DB.prepare(
      "UPDATE posts SET x_account_id = ?, text = ?, scheduled_at = ?, condition = ?, status = ?, link_preview_url = ?, link_preview_title = ?, link_preview_description = ?, link_preview_image_url = ?, updated_at = ?, failure_reason = NULL WHERE id = ?",
    )
      .bind(
        xAccountId,
        text,
        scheduledAt.toISOString(),
        condition,
        status,
        preview?.url ?? null,
        preview?.title ?? null,
        preview?.description ?? null,
        preview?.imageUrl ?? null,
        now,
        id,
      )
      .run();
    await Promise.all(
      existingMedia.map((media) =>
        env.DB.prepare("UPDATE post_media SET alt_text = ? WHERE id = ?")
          .bind(String(form.get(`alt-${media.id}`) ?? ""), media.id)
          .run(),
      ),
    );
  } else {
    await env.DB.prepare(
      "INSERT INTO posts (id, chapter_id, x_account_id, text, scheduled_at, condition, status, created_by_user_id, link_preview_url, link_preview_title, link_preview_description, link_preview_image_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        access.chapter.chapterId,
        xAccountId,
        text,
        scheduledAt.toISOString(),
        condition,
        status,
        access.user.id,
        preview?.url ?? null,
        preview?.title ?? null,
        preview?.description ?? null,
        preview?.imageUrl ?? null,
        now,
        now,
      )
      .run();
  }
  for (const [index, file] of files.entries()) {
    const key = `${access.chapter.chapterId}/${id}/${crypto.randomUUID()}`;
    await env.MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
    await env.DB.prepare(
      "INSERT INTO post_media (id, post_id, r2_key, content_type, byte_size, alt_text, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        id,
        key,
        file.type,
        file.size,
        String(form.get(`new-alt-${index}`) ?? ""),
        existingMedia.length + index,
        nowIso(),
      )
      .run();
  }
  const handles = String(form.get("tagHandles") ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 10);
  await env.DB.prepare("DELETE FROM post_media_tags WHERE post_id = ?").bind(id).run();
  for (const handle of handles) {
    // Resolve at submit time; failures are user-visible rather than creating an invalid X tag.
    const { resolveXUsername } = await import("~/lib/x.server");
    const resolved = await resolveXUsername(env, xAccountId, handle);
    await env.DB.prepare(
      "INSERT INTO post_media_tags (post_id, x_user_id, username) VALUES (?, ?, ?)",
    )
      .bind(id, resolved.id, resolved.username)
      .run();
  }
  await claimAndPublish(env, id);
  throw redirect("/posts");
}

export default function Schedule({ loaderData, actionData }: Route.ComponentProps) {
  const post = loaderData.post;
  const localDateTime = post
    ? new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
        dateStyle: "short",
        timeStyle: "short",
        hour12: false,
      })
        .format(new Date(post.scheduledAt))
        .replace(" ", "T")
    : "";
  return (
    <AppShell user={loaderData.user} chapter={loaderData.chapter} chapters={loaderData.chapters}>
      <div className="border-b px-4 py-4">
        <h1 className="text-xl font-bold">{post ? "予約投稿を編集" : "Schedule"}</h1>
      </div>
      <Form method="post" encType="multipart/form-data" className="space-y-4 p-4">
        {post ? <input type="hidden" name="postId" value={post.id} /> : null}
        {actionData?.error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionData.error}</p>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-sm font-medium">投稿先アカウント</span>
          <select
            name="xAccountId"
            defaultValue={post?.xAccountId}
            className="w-full rounded-xl border bg-card p-3"
          >
            {loaderData.accounts.length ? (
              loaderData.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  @{account.username} — {account.displayName}
                </option>
              ))
            ) : (
              <option value="">Xアカウントを認可してください</option>
            )}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">本文</span>
          <textarea
            name="text"
            defaultValue={post?.text}
            maxLength={280}
            required
            rows={6}
            placeholder="いまどうしてる？"
            className="w-full resize-none border-0 bg-transparent text-lg outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">予約日時（JST）</span>
          <input
            name="scheduledAt"
            type="datetime-local"
            defaultValue={localDateTime}
            required
            className="w-full rounded-xl border bg-card p-3"
          />
        </label>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">投稿条件</legend>
          <label className="mr-4">
            <input
              type="radio"
              name="condition"
              value="scheduled"
              defaultChecked={!post || post.condition === "scheduled"}
            />{" "}
            指定時刻に投稿
          </label>
          <label>
            <input
              type="radio"
              name="condition"
              value="photo_required"
              defaultChecked={post?.condition === "photo_required"}
            />{" "}
            写真が添付されたら投稿
          </label>
        </fieldset>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">画像内でタグ付けするXユーザー</span>
          <input
            name="tagHandles"
            placeholder="@gdg_tokyo @gdg_osaka"
            className="w-full rounded-xl border bg-card p-3"
          />
        </label>
        {loaderData.media.map((image) => (
          <label key={image.id} className="flex items-center gap-3">
            <img
              src={`/api/media/${image.id}`}
              alt=""
              className="size-16 rounded-lg object-cover"
            />
            <input
              name={`alt-${image.id}`}
              defaultValue={image.altText}
              placeholder="画像の説明（Alt）"
              className="min-w-0 flex-1 rounded-xl border bg-card p-3"
            />
          </label>
        ))}
        <div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full px-3 py-2 text-primary hover:bg-muted">
            <ImagePlus className="size-5" />
            端末から写真を追加
            <input name="images" type="file" accept="image/*" multiple className="hidden" />
          </label>
          <p className="mt-1 text-xs text-muted-foreground">最大4枚、各5MB。</p>
          {post ? (
            <a
              className="mt-2 inline-block text-sm text-primary"
              href={`/google/photos/connect?postId=${post.id}`}
            >
              Google Photos から選ぶ
            </a>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Google Photos は予約を保存後に追加できます。
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={!loaderData.accounts.length}
          className="w-full rounded-full bg-primary px-5 py-3 font-bold text-white disabled:opacity-50"
        >
          {post ? "変更を保存" : "予約する"}
        </button>
        {post ? (
          <Link to="/posts" className="block text-center text-sm text-muted-foreground">
            キャンセル
          </Link>
        ) : null}
      </Form>
    </AppShell>
  );
}
