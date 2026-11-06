import type { PrActor, PrRpcResult, SnsPostSummary, SnsXAccountSummary } from "@gdgjp/gdg-lib";
import { canPostForChapter } from "~/features/auth/rpc-access.server";
import { listXAccounts } from "~/features/x-accounts/x-account.repository.server";
import { postDraftDepsFromEnv } from "./post-draft.deps.server";
import {
  PostDraftError,
  attachMedia,
  createDraft,
  getDraft,
  updateDraft,
} from "./post-draft.service.server";
import type { Post } from "./post.types";

/** The calls pr.gdgs.jp makes through the PR_SERVICE entrypoint (workers/app.ts). */

const summary = (post: Post): SnsPostSummary => ({
  id: post.id,
  status: post.status,
  scheduledAt: post.scheduledAt,
  publishedXPostId: post.publishedXPostId,
  failureReason: post.failureReason,
});

async function guard<T>(
  env: Env,
  actor: PrActor,
  chapterId: number,
  run: () => Promise<PrRpcResult<T>>,
): Promise<PrRpcResult<T>> {
  if (!(await canPostForChapter(env.DB, actor, chapterId))) return { ok: false, code: "forbidden" };
  try {
    return await run();
  } catch (error) {
    if (error instanceof PostDraftError)
      return { ok: false, code: error.code, message: error.message };
    return {
      ok: false,
      code: "internal_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function prListXAccounts(env: Env, input: { actor: PrActor; chapterId: number }) {
  const canPost = await canPostForChapter(env.DB, input.actor, input.chapterId);
  const accounts: SnsXAccountSummary[] = (await listXAccounts(env.DB, input.chapterId)).map(
    (a) => ({
      id: a.id,
      username: a.username,
      displayName: a.displayName,
    }),
  );
  return { ok: true as const, accounts, canPost };
}

export async function prCreateScheduledPost(
  env: Env,
  input: {
    actor: PrActor;
    chapterId: number;
    xAccountId: string;
    text: string;
    scheduledAt: string;
    condition: "scheduled" | "photo_required";
    tagHandles?: string[];
  },
) {
  return guard<{ post: SnsPostSummary }>(env, input.actor, input.chapterId, async () => {
    const post = await createDraft(postDraftDepsFromEnv(env), {
      chapterId: input.chapterId,
      xAccountId: input.xAccountId,
      text: input.text,
      scheduledAt: input.scheduledAt,
      condition: input.condition,
      createdByUserId: input.actor.user.id,
      tagHandles: input.tagHandles,
    });
    return { ok: true, post: summary(post) };
  });
}

/** The post must belong to the chapter the actor posts for. */
async function ownedPost(env: Env, chapterId: number, postId: string) {
  const detail = await getDraft(postDraftDepsFromEnv(env), postId);
  return detail && detail.post.chapterId === chapterId ? detail : null;
}

export async function prUpdatePost(
  env: Env,
  input: { actor: PrActor; chapterId: number; postId: string; text?: string; scheduledAt?: string },
) {
  return guard<{ post: SnsPostSummary }>(env, input.actor, input.chapterId, async () => {
    if (!(await ownedPost(env, input.chapterId, input.postId)))
      return { ok: false, code: "not_found" };
    const post = await updateDraft(postDraftDepsFromEnv(env), input.postId, {
      text: input.text,
      scheduledAt: input.scheduledAt,
    });
    return { ok: true, post: summary(post) };
  });
}

export async function prAttachMedia(
  env: Env,
  input: {
    actor: PrActor;
    chapterId: number;
    postId: string;
    bytes: ArrayBuffer;
    contentType: string;
    altText?: string;
    sortOrder: number;
  },
) {
  return guard<{ mediaId: string }>(env, input.actor, input.chapterId, async () => {
    if (!(await ownedPost(env, input.chapterId, input.postId)))
      return { ok: false, code: "not_found" };
    const result = await attachMedia(postDraftDepsFromEnv(env), input.postId, {
      bytes: input.bytes,
      contentType: input.contentType,
      altText: input.altText,
      sortOrder: input.sortOrder,
    });
    return { ok: true, mediaId: result.media.id };
  });
}

export async function prGetPost(
  env: Env,
  input: { actor: PrActor; chapterId: number; postId: string },
) {
  return guard<{ post: SnsPostSummary }>(env, input.actor, input.chapterId, async () => {
    const detail = await ownedPost(env, input.chapterId, input.postId);
    return detail ? { ok: true, post: summary(detail.post) } : { ok: false, code: "not_found" };
  });
}
