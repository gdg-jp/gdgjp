import { listPostMedia } from "~/features/posts/post-media.repository.server";
import { getPost } from "~/features/posts/post.repository.server";
import type { Post } from "~/features/posts/post.types";
import { nowIso } from "~/lib/utils";
import { runXPublish } from "./post-publishing.service.server";

export type PublishNowResult =
  | { outcome: "published"; post: Post }
  | { outcome: "x_failed"; post: Post }
  | { outcome: "not_found" }
  | {
      outcome: "conflict";
      code: "already_published" | "already_posting" | "missing_required_media";
    };

export async function publishNow(
  env: Env,
  postId: string,
  actor: { id: string },
): Promise<PublishNowResult> {
  const post = await getPost(env.DB, postId);
  if (!post) return { outcome: "not_found" };
  if (post.status === "published") return { outcome: "conflict", code: "already_published" };
  if (post.status === "posting") return { outcome: "conflict", code: "already_posting" };

  const media = (await listPostMedia(env.DB, [postId]))[postId] ?? [];
  if (post.condition === "photo_required" && media.length === 0) {
    return { outcome: "conflict", code: "missing_required_media" };
  }

  const claim = await env.DB.prepare(
    "UPDATE posts SET status = 'posting', updated_at = ? WHERE id = ? AND status IN ('scheduled', 'waiting_for_photo', 'failed', 'needs_confirmation')",
  )
    .bind(nowIso(), postId)
    .run();
  if (claim.meta.changes !== 1) {
    const current = await getPost(env.DB, postId);
    return current?.status === "published"
      ? { outcome: "conflict", code: "already_published" }
      : { outcome: "conflict", code: "already_posting" };
  }

  const result = await runXPublish(env, postId);
  console.log(
    JSON.stringify({
      message: "sns publish-now",
      postId,
      actorId: actor.id,
      outcome: result.status,
    }),
  );
  return result.status === "published"
    ? { outcome: "published", post: result.post }
    : { outcome: "x_failed", post: result.post };
}
