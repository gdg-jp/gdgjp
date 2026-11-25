import type { Post } from "~/features/posts/post.types";
import { getXAccount } from "~/features/x-accounts/x-account.repository.server";
import { nowIso } from "~/lib/utils";
import {
  compactPostMediaStatements,
  deletePostMediaById,
  deletePostMediaStatement,
  getPostMediaById,
  insertPostMedia,
  insertPostMediaStatement,
  listMediaForPost,
} from "./post-media.repository.server";
import {
  isEditableStatus,
  isValidCondition,
  isValidPostText,
  isValidScheduledAt,
  normalizeTagHandles,
  recomputeDraftStatus,
  validateMediaSortOrder,
  validateNewMedia,
} from "./post-policy";
import {
  deletePostRow,
  getPost,
  insertPostStatement,
  replacePostMediaTagsStatements,
  updatePostFieldsStatement,
  updatePostStatus,
} from "./post.repository.server";
import type {
  AttachMediaInput,
  CreateDraftInput,
  PostDetail,
  PostDraftDependencies,
  ScheduledDraftInput,
  UpdateDraftPatch,
} from "./post.types";

export type PostDraftErrorCode =
  | "not_found"
  | "not_editable"
  | "invalid_text"
  | "invalid_schedule"
  | "invalid_condition"
  | "account_not_found"
  | "too_many_images"
  | "image_too_large"
  | "not_image"
  | "invalid_sort_order"
  | "sort_order_taken"
  | "tag_handle_not_found"
  | "tag_lookup_unavailable"
  | "media_storage_cleanup_failed";

export class PostDraftError extends Error {
  readonly code: PostDraftErrorCode;
  constructor(code: PostDraftErrorCode, message?: string) {
    super(message ?? code);
    this.name = "PostDraftError";
    this.code = code;
  }
}

type PersistedLinkPreview = {
  url: string | null;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
};

async function derivePreview(
  deps: PostDraftDependencies,
  text: string,
): Promise<PersistedLinkPreview> {
  const preview = await deps.linkPreviewForText(text).catch(() => null);
  return {
    url: preview?.url ?? null,
    title: preview?.title ?? null,
    description: preview?.description ?? null,
    imageUrl: preview?.imageUrl ?? null,
  };
}

async function assertActiveChapterAccount(
  deps: PostDraftDependencies,
  chapterId: number,
  xAccountId: string,
): Promise<void> {
  const account = await getXAccount(deps.db, xAccountId);
  if (!account || account.revokedAt || account.chapterId !== chapterId) {
    throw new PostDraftError("account_not_found");
  }
}

async function resolveTags(
  deps: PostDraftDependencies,
  xAccountId: string,
  handles: string[] | undefined,
): Promise<{ xUserId: string; username: string }[] | null> {
  if (handles === undefined) return null;
  const resolved = new Map<string, { xUserId: string; username: string }>();
  for (const handle of normalizeTagHandles(handles)) {
    const user = await deps.resolveTagHandle(xAccountId, handle).catch((error: unknown) => {
      throw new PostDraftError(
        "tag_lookup_unavailable",
        error instanceof Error ? error.message : "X user lookup failed",
      );
    });
    if (!user) throw new PostDraftError("tag_handle_not_found", `X user ${handle} was not found`);
    if (!resolved.has(user.id))
      resolved.set(user.id, { xUserId: user.id, username: user.username });
  }
  return [...resolved.values()];
}

async function reconcileStatusForMediaCount(
  deps: PostDraftDependencies,
  post: Post,
  mediaCount: number,
): Promise<void> {
  if (post.status !== "scheduled" && post.status !== "waiting_for_photo") return;
  const next = recomputeDraftStatus(post.condition, mediaCount);
  if (next !== post.status) await updatePostStatus(deps.db, post.id, next);
}

async function reloadPost(deps: PostDraftDependencies, id: string): Promise<Post> {
  const post = await getPost(deps.db, id);
  if (!post) throw new PostDraftError("not_found");
  return post;
}

export async function createDraft(
  deps: PostDraftDependencies,
  input: CreateDraftInput,
): Promise<Post> {
  if (!isValidPostText(input.text)) throw new PostDraftError("invalid_text");
  if (!isValidScheduledAt(input.scheduledAt)) throw new PostDraftError("invalid_schedule");
  if (!isValidCondition(input.condition)) throw new PostDraftError("invalid_condition");
  await assertActiveChapterAccount(deps, input.chapterId, input.xAccountId);
  const tags = await resolveTags(deps, input.xAccountId, input.tagHandles);

  const id = crypto.randomUUID();
  const now = nowIso();
  const status = recomputeDraftStatus(input.condition, 0);
  const linkPreview = await derivePreview(deps, input.text);
  await deps.db.batch([
    insertPostStatement(deps.db, {
      id,
      chapterId: input.chapterId,
      xAccountId: input.xAccountId,
      text: input.text,
      scheduledAt: input.scheduledAt,
      condition: input.condition,
      status,
      createdByUserId: input.createdByUserId,
      linkPreview,
      now,
    }),
    ...(tags
      ? replacePostMediaTagsStatements(deps.db, { postId: id, status, updatedAt: now }, tags)
      : []),
  ]);
  return reloadPost(deps, id);
}

export async function updateDraft(
  deps: PostDraftDependencies,
  id: string,
  patch: UpdateDraftPatch,
): Promise<Post> {
  const existing = await getPost(deps.db, id);
  if (!existing) throw new PostDraftError("not_found");
  if (!isEditableStatus(existing.status)) throw new PostDraftError("not_editable");

  const xAccountId = patch.xAccountId ?? existing.xAccountId;
  const text = patch.text ?? existing.text;
  const scheduledAt = patch.scheduledAt ?? existing.scheduledAt;
  const condition = patch.condition ?? existing.condition;

  if (!isValidPostText(text)) throw new PostDraftError("invalid_text");
  if (!isValidScheduledAt(scheduledAt)) throw new PostDraftError("invalid_schedule");
  if (!isValidCondition(condition)) throw new PostDraftError("invalid_condition");
  await assertActiveChapterAccount(deps, existing.chapterId, xAccountId);
  const tags = await resolveTags(deps, xAccountId, patch.tagHandles);

  const mediaCount = (await listMediaForPost(deps.db, id)).length;
  const linkPreview =
    text === existing.text
      ? {
          url: existing.linkPreviewUrl,
          title: existing.linkPreviewTitle,
          description: existing.linkPreviewDescription,
          imageUrl: existing.linkPreviewImageUrl,
        }
      : await derivePreview(deps, text);

  const status = recomputeDraftStatus(condition, mediaCount);
  const now = nowIso();
  const [updated] = await deps.db.batch([
    updatePostFieldsStatement(deps.db, id, {
      xAccountId,
      text,
      scheduledAt,
      condition,
      status,
      linkPreview,
      now,
    }),
    ...(tags
      ? replacePostMediaTagsStatements(deps.db, { postId: id, status, updatedAt: now }, tags)
      : []),
  ]);
  if (!updated?.meta.changes) throw new PostDraftError("not_editable");
  return reloadPost(deps, id);
}

export async function saveScheduledDraft(
  deps: PostDraftDependencies,
  input: ScheduledDraftInput,
): Promise<Post> {
  if (!isValidPostText(input.text)) throw new PostDraftError("invalid_text");
  if (!isValidScheduledAt(input.scheduledAt)) throw new PostDraftError("invalid_schedule");
  if (!isValidCondition(input.condition)) throw new PostDraftError("invalid_condition");
  const existing = input.postId ? await getPost(deps.db, input.postId) : null;
  if (input.postId && !existing) throw new PostDraftError("not_found");
  if (existing && !isEditableStatus(existing.status)) throw new PostDraftError("not_editable");
  const chapterId = existing?.chapterId ?? input.chapterId;
  await assertActiveChapterAccount(deps, chapterId, input.xAccountId);

  const current = existing ? await listMediaForPost(deps.db, existing.id) : [];
  const { keep, remove, add } = input.media;
  const named = new Set([...keep.map((item) => item.id), ...remove]);
  if (named.size !== keep.length + remove.length || current.some((item) => !named.has(item.id)))
    throw new PostDraftError("not_found");
  if (current.length !== named.size) throw new PostDraftError("not_found");
  const position = new Map(current.map((item) => [item.id, item.sortOrder]));
  const kept = [...keep].sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  const invalid = validateNewMedia(
    keep.length,
    add.map((file) => ({ size: file.bytes.byteLength, contentType: file.contentType })),
  );
  if (invalid) throw new PostDraftError(invalid);
  const tags = await resolveTags(deps, input.xAccountId, input.tagHandles);
  const linkPreview =
    existing && input.text === existing.text
      ? {
          url: existing.linkPreviewUrl,
          title: existing.linkPreviewTitle,
          description: existing.linkPreviewDescription,
          imageUrl: existing.linkPreviewImageUrl,
        }
      : await derivePreview(deps, input.text);

  const id = existing?.id ?? crypto.randomUUID();
  const now = nowIso();
  const status = recomputeDraftStatus(input.condition, keep.length + add.length);
  const edit = { postId: id, status, updatedAt: now };
  const added = add.map((file, index) => ({
    id: crypto.randomUUID(),
    postId: id,
    r2Key: `${chapterId}/${id}/${crypto.randomUUID()}`,
    contentType: file.contentType,
    byteSize: file.bytes.byteLength,
    altText: file.altText,
    sortOrder: keep.length + index,
    bytes: file.bytes,
  }));
  const stored: string[] = [];
  try {
    for (const file of added) {
      await deps.media.put(file.r2Key, file.bytes, {
        httpMetadata: { contentType: file.contentType },
      });
      stored.push(file.r2Key);
    }
    const [written] = await deps.db.batch([
      existing
        ? updatePostFieldsStatement(deps.db, id, {
            xAccountId: input.xAccountId,
            text: input.text,
            scheduledAt: input.scheduledAt,
            condition: input.condition,
            status,
            linkPreview,
            now,
          })
        : insertPostStatement(deps.db, {
            id,
            chapterId,
            xAccountId: input.xAccountId,
            text: input.text,
            scheduledAt: input.scheduledAt,
            condition: input.condition,
            status,
            createdByUserId: input.createdByUserId,
            linkPreview,
            now,
          }),
      ...(tags ? replacePostMediaTagsStatements(deps.db, edit, tags) : []),
      ...remove.map((mediaId) => deletePostMediaStatement(deps.db, edit, mediaId)),
      ...compactPostMediaStatements(deps.db, edit, kept),
      ...added.map(({ bytes: _, ...record }) => insertPostMediaStatement(deps.db, edit, record)),
    ]);
    if (!written?.meta.changes) throw new PostDraftError("not_editable");
  } catch (error) {
    await Promise.allSettled(stored.map((key) => deps.media.delete(key)));
    throw error;
  }
  const removedKeys = current.filter((item) => remove.includes(item.id)).map((item) => item.r2Key);
  await Promise.allSettled(removedKeys.map((key) => deps.media.delete(key)));
  return reloadPost(deps, id);
}

export async function deleteDraft(
  deps: PostDraftDependencies,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await getPost(deps.db, id);
  if (!existing) return { ok: false, error: "not_found" };
  const media = await listMediaForPost(deps.db, id);
  // D1's `changes` uses SQLite's total-change count, so cascaded media/tag
  // deletions can push it past one even when the post row itself was removed.
  const changes = await deletePostRow(deps.db, id);
  if (changes < 1) return { ok: false, error: "not_deletable" };
  await Promise.all(media.map((item) => deps.media.delete(item.r2Key)));
  return { ok: true };
}

export async function getDraft(
  deps: PostDraftDependencies,
  id: string,
): Promise<PostDetail | null> {
  const post = await getPost(deps.db, id);
  if (!post) return null;
  return { post, media: await listMediaForPost(deps.db, id) };
}

export async function attachMedia(
  deps: PostDraftDependencies,
  postId: string,
  file: AttachMediaInput,
): Promise<{ media: NonNullable<Awaited<ReturnType<typeof insertPostMedia>>>; post: Post }> {
  const post = await getPost(deps.db, postId);
  if (!post) throw new PostDraftError("not_found");
  if (!isEditableStatus(post.status)) throw new PostDraftError("not_editable");

  const existing = await listMediaForPost(deps.db, postId);
  const invalid =
    validateNewMedia(existing.length, [
      { size: file.bytes.byteLength, contentType: file.contentType },
    ]) ??
    validateMediaSortOrder(
      existing.map((media) => media.sortOrder),
      file.sortOrder,
    );
  if (invalid) throw new PostDraftError(invalid);

  const r2Key = `${post.chapterId}/${post.id}/${crypto.randomUUID()}`;
  await deps.media.put(r2Key, file.bytes, { httpMetadata: { contentType: file.contentType } });
  let media: Awaited<ReturnType<typeof insertPostMedia>>;
  try {
    media = await insertPostMedia(deps.db, {
      id: crypto.randomUUID(),
      postId,
      r2Key,
      contentType: file.contentType,
      byteSize: file.bytes.byteLength,
      altText: file.altText ?? "",
      sortOrder: file.sortOrder,
    });
  } catch (error) {
    await deps.media.delete(r2Key).catch(() => {});
    throw error;
  }
  if (!media) {
    await deps.media.delete(r2Key).catch(() => {});
    throw new PostDraftError("sort_order_taken");
  }

  await reconcileStatusForMediaCount(deps, post, existing.length + 1);
  return { media, post: await reloadPost(deps, postId) };
}

export async function removeMedia(
  deps: PostDraftDependencies,
  mediaId: string,
): Promise<{ id: string; deleted: true; post: Post }> {
  const media = await getPostMediaById(deps.db, mediaId);
  if (!media) throw new PostDraftError("not_found");
  const post = await getPost(deps.db, media.postId);
  if (!post) throw new PostDraftError("not_found");
  if (!isEditableStatus(post.status)) throw new PostDraftError("not_editable");

  const remainingCount = Math.max((await listMediaForPost(deps.db, media.postId)).length - 1, 0);
  const r2Key = media.r2Key;
  await deletePostMediaById(deps.db, mediaId);
  await reconcileStatusForMediaCount(deps, post, remainingCount);
  try {
    await deps.media.delete(r2Key);
  } catch (error) {
    throw new PostDraftError(
      "media_storage_cleanup_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  return { id: mediaId, deleted: true, post: await reloadPost(deps, media.postId) };
}
