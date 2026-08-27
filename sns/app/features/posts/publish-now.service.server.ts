import type { Post } from "~/lib/db.server";
import { getPost, listPostMedia } from "~/lib/db.server";
import { nowIso } from "~/lib/utils";
import { runXPublish } from "./post-publishing.service.server";

/**
 * `x_failed` carries a persisted post whose `status` is `failed` or
 * `needs_confirmation` (with `failureReason` set); the route returns it with a
 * 502 so a script can read why. `conflict` never touched X.
 */
export type PublishNowResult =
  | { outcome: "published"; post: Post }
  | { outcome: "x_failed"; post: Post }
  | { outcome: "not_found" }
  | {
      outcome: "conflict";
      code: "already_published" | "already_posting" | "missing_required_media";
    };

/**
 * Operator-triggered "publish to X now". Unlike the cron's `claimAndPublish`,
 * it ignores a future `scheduledAt` and also accepts `needs_confirmation` as a
 * retry source — but only ever through this explicit call. The cron's claim set
 * still omits `needs_confirmation`, so the two paths cannot race and cron never
 * reclaims an uncertain post on its own.
 *
 * `published`/`posting` are refused with a conflict, as is a `photo_required`
 * post with no attached media. Everything else is atomically claimed and handed
 * to the one shared X-posting step.
 */
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
    // Lost the race — the minute cron (or another caller) claimed it first.
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
