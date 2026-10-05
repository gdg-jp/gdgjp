import { data, redirect } from "react-router";
import { requireSnsAccess } from "~/features/auth/access.server";
import { MAX_IMAGES, MAX_IMAGE_BYTES } from "~/features/posts/media-policy";
import { listXAccounts } from "~/features/x-accounts/x-account.repository.server";
import { postDraftDepsFromEnv } from "./post-draft.deps.server";
import {
  PostDraftError,
  attachMedia,
  createDraft,
  deleteDraft,
  getDraft,
  removeMedia,
  updateDraft,
  updateMediaMetadata,
} from "./post-draft.service.server";
import { listPostMedia } from "./post-media.repository.server";
import { getPost } from "./post.repository.server";
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

  const tagHandles = [String(form.get("tagHandles") ?? "")];
  let post: Post;
  try {
    if (existing) {
      for (const media of deletedMedia) await removeMedia(deps, media.id);
      await updateMediaMetadata(
        deps,
        remainingMedia.map((media, index) => ({
          id: media.id,
          altText: String(form.get(`alt-${media.id}`) ?? ""),
          sortOrder: index,
        })),
      );
      post = await updateDraft(deps, existing.id, {
        xAccountId,
        text,
        scheduledAt,
        condition,
        tagHandles,
      });
    } else {
      post = await createDraft(deps, {
        chapterId: access.chapter.chapterId,
        xAccountId,
        text,
        scheduledAt,
        condition,
        createdByUserId: access.user.id,
        tagHandles,
      });
    }
    for (const [index, file] of files.entries()) {
      const result = await attachMedia(deps, post.id, {
        bytes: await file.arrayBuffer(),
        contentType: file.type,
        altText: String(form.get(`new-alt-${index}`) ?? ""),
        sortOrder: remainingMedia.length + index,
      });
      post = result.post;
    }
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
