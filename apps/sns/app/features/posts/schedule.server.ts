import { data, redirect } from "react-router";
import { requireSnsAccess } from "~/features/auth/access.server";
import { MAX_IMAGES, MAX_IMAGE_BYTES } from "~/features/posts/media-policy";
import { listXAccounts } from "~/features/x-accounts/x-account.repository.server";
import { postDraftDepsFromEnv } from "./post-draft.deps.server";
import {
  PostDraftError,
  deleteDraft,
  getDraft,
  saveScheduledDraft,
} from "./post-draft.service.server";
import { listPostMedia } from "./post-media.repository.server";
import { getPost, listPostTagUsernames } from "./post.repository.server";
import type { Post } from "./post.types";
import { type PostingOption, postingOptionCookie, postingOptionFromCookie } from "./posting-option";
import { claimAndPublish } from "./scheduled-publishing.server";
import { parseXPostText } from "./x-text";

export async function loadSchedule(request: Request, env: Env) {
  const access = await requireSnsAccess(env, request);
  const editId = new URL(request.url).searchParams.get("edit");
  const post = editId ? await getPost(env.DB, editId) : null;
  if (post && post.chapterId !== access.chapter.chapterId)
    throw new Response("Forbidden", { status: 403 });
  return {
    ...access,
    accounts: await listXAccounts(env.DB, access.chapter.chapterId),
    post,
    media: post ? ((await listPostMedia(env.DB, [post.id]))[post.id] ?? []) : [],
    tagHandles: post
      ? (await listPostTagUsernames(env.DB, post.id)).map((name) => `@${name}`).join(" ")
      : "",
    defaultPostingOption: postingOptionFromCookie(request),
  };
}

export async function submitSchedule(request: Request, env: Env) {
  const access = await requireSnsAccess(env, request);
  const form = await request.formData();
  const deps = postDraftDepsFromEnv(env);
  const intent = String(form.get("intent") ?? "save");

  if (intent === "delete") {
    const postId = String(form.get("postId") ?? "");
    const post = await getPost(env.DB, postId);
    if (!post || post.chapterId !== access.chapter.chapterId)
      throw new Response("Not found", { status: 404 });
    const result = await deleteDraft(deps, post.id);
    if (!result.ok)
      return data({ error: "投稿中または投稿済みの予約は削除できません。" }, { status: 409 });
    throw redirect("/posts");
  }

  const text = String(form.get("text") ?? "");
  const xAccountId = String(form.get("xAccountId") ?? "");
  const postingOption: PostingOption =
    form.get("postingOption") === "immediate"
      ? "immediate"
      : form.get("postingOption") === "scheduled"
        ? "scheduled"
        : "photo_required";
  const condition = postingOption === "photo_required" ? "photo_required" : "scheduled";
  const scheduledInput = String(form.get("scheduledAt") ?? "");
  const scheduledDate =
    postingOption === "immediate" ? new Date() : new Date(`${scheduledInput}:00+09:00`);
  if (
    !text.trim() ||
    !parseXPostText(text).valid ||
    !xAccountId ||
    Number.isNaN(scheduledDate.getTime())
  )
    return data({ error: "本文、投稿先、予約日時を確認してください。" }, { status: 400 });
  const scheduledAt = scheduledDate.toISOString();

  const id = String(form.get("postId") ?? "");
  const existing = id ? await getPost(env.DB, id) : null;
  if (existing && existing.chapterId !== access.chapter.chapterId)
    throw new Response("Forbidden", { status: 403 });
  if (existing?.status === "published" || existing?.status === "posting")
    return data({ error: "投稿中または投稿済みの予約は変更できません。" }, { status: 409 });

  const existingMedia = existing ? ((await getDraft(deps, existing.id))?.media ?? []) : [];
  const deletedMediaIds = new Set(form.getAll("deletedMedia").map(String));
  const deletedMedia = existingMedia.filter((media) => deletedMediaIds.has(media.id));
  const remainingMedia = existingMedia.filter((media) => !deletedMediaIds.has(media.id));
  const files = form
    .getAll("images")
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (
    remainingMedia.length + files.length > MAX_IMAGES ||
    files.some((file) => file.size > MAX_IMAGE_BYTES || !file.type.startsWith("image/"))
  )
    return data(
      { error: "画像は4枚まで、1枚5MB以下の画像ファイルを指定してください。" },
      { status: 400 },
    );

  const tagHandles = form.has("tagHandles") ? [String(form.get("tagHandles"))] : undefined;
  let post: Post;
  try {
    post = await saveScheduledDraft(deps, {
      postId: existing?.id ?? null,
      chapterId: access.chapter.chapterId,
      createdByUserId: access.user.id,
      xAccountId,
      text,
      scheduledAt,
      condition,
      tagHandles,
      media: {
        keep: remainingMedia.map((media) => ({
          id: media.id,
          altText: String(form.get(`alt-${media.id}`) ?? ""),
        })),
        remove: deletedMedia.map((media) => media.id),
        add: await Promise.all(
          files.map(async (file, index) => ({
            bytes: await file.arrayBuffer(),
            contentType: file.type,
            altText: String(form.get(`new-alt-${index}`) ?? ""),
          })),
        ),
      },
    });
  } catch (error) {
    if (error instanceof PostDraftError) {
      if (error.code === "account_not_found") throw new Response("Forbidden", { status: 403 });
      if (error.code === "not_editable")
        return data({ error: "投稿中または投稿済みの予約は変更できません。" }, { status: 409 });
      if (
        error.code === "too_many_images" ||
        error.code === "image_too_large" ||
        error.code === "not_image"
      )
        return data(
          { error: "画像は4枚まで、1枚5MB以下の画像ファイルを指定してください。" },
          { status: 400 },
        );
      if (error.code === "tag_lookup_unavailable")
        return data(
          { error: "X に問い合わせできませんでした。しばらくしてから保存し直してください。" },
          { status: 503 },
        );
      if (error.code === "tag_handle_not_found")
        return data(
          {
            error: "タグ付けする X ユーザーが見つかりませんでした。ユーザー名を確認してください。",
          },
          { status: 400 },
        );
      if (
        error.code === "invalid_text" ||
        error.code === "invalid_schedule" ||
        error.code === "invalid_condition"
      )
        return data({ error: "本文、投稿先、予約日時を確認してください。" }, { status: 400 });
    }
    throw error;
  }

  if (intent === "save_and_add_google_photos")
    throw redirect(`/google/photos/library?postId=${post.id}`, {
      headers: { "Set-Cookie": postingOptionCookie(postingOption) },
    });
  await claimAndPublish(env, post.id);
  throw redirect("/posts", { headers: { "Set-Cookie": postingOptionCookie(postingOption) } });
}
