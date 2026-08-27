import { runXPublish } from "~/features/posts/post-publishing.service.server";
import { getPost, listPostMedia } from "~/lib/db.server";
import { nowIso } from "~/lib/utils";

export async function claimAndPublish(env: Env, postId: string): Promise<void> {
  const post = await getPost(env.DB, postId);
  if (!post || new Date(post.scheduledAt).getTime() > Date.now()) return;
  const media = (await listPostMedia(env.DB, [post.id]))[post.id] ?? [];
  if (post.condition === "photo_required" && media.length === 0) return;
  const claim = await env.DB.prepare(
    "UPDATE posts SET status = 'posting', updated_at = ? WHERE id = ? AND status IN ('scheduled', 'waiting_for_photo', 'failed')",
  )
    .bind(nowIso(), post.id)
    .run();
  // The claimed post now goes through the one shared X-posting step; the CLI's
  // `publishNow` uses the same step after its own atomic claim, so the minute
  // cron and an operator "publish now" can never both post the same row.
  if (claim.meta.changes === 1) await runXPublish(env, post.id);
}

export async function publishDuePosts(env: Env): Promise<void> {
  const due = await env.DB.prepare(
    "SELECT id FROM posts WHERE status IN ('scheduled', 'waiting_for_photo') AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 50",
  )
    .bind(nowIso())
    .all<{ id: string }>();
  for (const row of due.results) await claimAndPublish(env, row.id);
}
