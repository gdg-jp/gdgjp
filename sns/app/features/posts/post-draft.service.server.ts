import type { Post } from "~/lib/db.server";
import { getXAccount } from "~/lib/db.server";
import { nowIso } from "~/lib/utils";
import {
  batchUpdateMediaMetadata,
  deletePostMediaById,
  getPostMediaById,
  insertPostMedia,
  listMediaForPost,
} from "./post-media.repository.server";
import {
  isEditableStatus,
  isValidCondition,
  isValidPostText,
  isValidScheduledAt,
  normalizeTagHandles,
  recomputeDraftStatus,
  validateNewMedia,
} from "./post-policy";
import {
  deletePostRow,
  getPost,
  insertPost,
  replacePostMediaTags,
  updatePostFields,
  updatePostStatus,
} from "./post.repository.server";
import type {
  AttachMediaInput,
  CreateDraftInput,
  MediaMetadataEdit,
  PostDetail,
  PostDraftDependencies,
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
  handles: string[],
): Promise<{ xUserId: string; username: string }[]> {
  const resolved: { xUserId: string; username: string }[] = [];
  for (const handle of normalizeTagHandles(handles)) {
    const user = await deps.resolveTagHandle(xAccountId, handle);
    resolved.push({ xUserId: user.id, username: user.username });
  }
  return resolved;
}

/**
 * A media count change only flips the stored status while the post is still an
 * untouched draft; a `failed`/`needs_confirmation` post keeps its status and
 * failure reason (only the dashboard's explicit save clears those).
 */
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

  const id = crypto.randomUUID();
  const now = nowIso();
  const linkPreview = await derivePreview(deps, input.text);
  await insertPost(deps.db, {
    id,
    chapterId: input.chapterId,
    xAccountId: input.xAccountId,
    text: input.text,
    scheduledAt: input.scheduledAt,
    condition: input.condition,
    status: recomputeDraftStatus(input.condition, 0),
    createdByUserId: input.createdByUserId,
    linkPreview,
    now,
  });

  if (input.tagHandles !== undefined) {
    await replacePostMediaTags(
      deps.db,
      id,
      await resolveTags(deps, input.xAccountId, input.tagHandles),
    );
  }
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

  const mediaCount = (await listMediaForPost(deps.db, id)).length;
  // Only re-fetch a link preview when the final text actually changes, so a
  // pure schedule/account edit keeps the card the author already reviewed.
  const linkPreview =
    text === existing.text
      ? {
          url: existing.linkPreviewUrl,
          title: existing.linkPreviewTitle,
          description: existing.linkPreviewDescription,
          imageUrl: existing.linkPreviewImageUrl,
        }
      : await derivePreview(deps, text);

  await updatePostFields(deps.db, id, {
    xAccountId,
    text,
    scheduledAt,
    condition,
    status: recomputeDraftStatus(condition, mediaCount),
    linkPreview,
    now: nowIso(),
  });

  if (patch.tagHandles !== undefined) {
    await replacePostMediaTags(deps.db, id, await resolveTags(deps, xAccountId, patch.tagHandles));
  }
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
): Promise<{ media: Awaited<ReturnType<typeof insertPostMedia>>; post: Post }> {
  const post = await getPost(deps.db, postId);
  if (!post) throw new PostDraftError("not_found");
  if (!isEditableStatus(post.status)) throw new PostDraftError("not_editable");

  const existing = await listMediaForPost(deps.db, postId);
  const invalid = validateNewMedia(existing.length, [
    { size: file.bytes.byteLength, contentType: file.contentType },
  ]);
  if (invalid) throw new PostDraftError(invalid);

  // R2 write precedes the row it will be referenced by; a failed insert rolls
  // the just-written object back.
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
  // Capture the key for compensation before the row that records it is gone.
  const r2Key = media.r2Key;
  await deletePostMediaById(deps.db, mediaId);
  await reconcileStatusForMediaCount(deps, post, remainingCount);
  try {
    await deps.media.delete(r2Key);
  } catch (error) {
    // The row is already gone, so the object is orphaned. Surface it instead
    // of reporting a clean success so cleanup can be retried.
    throw new PostDraftError(
      "media_storage_cleanup_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  return { id: mediaId, deleted: true, post: await reloadPost(deps, media.postId) };
}

/**
 * Applies alt-text / sort-order edits to media that survive a dashboard save.
 * Internal to this feature — the CLI surface only attaches and removes.
 */
export async function updateMediaMetadata(
  deps: PostDraftDependencies,
  edits: MediaMetadataEdit[],
): Promise<void> {
  await batchUpdateMediaMetadata(deps.db, edits);
}
