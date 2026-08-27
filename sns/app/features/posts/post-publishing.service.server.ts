import { accessTokenForAccount } from "~/features/x-accounts/x-provider.server";
import type { Post } from "~/lib/db.server";
import { getPost, listPostMedia } from "~/lib/db.server";
import { nowIso } from "~/lib/utils";

/**
 * Terminal outcome of the shared X-posting step. `failed` and
 * `needs_confirmation` are both persisted before returning — never thrown — so
 * the caller can surface the reason from `post.failureReason`.
 * `needs_confirmation` marks an *uncertain* attempt (network/timeout) that an
 * operator must reconcile against X before retrying.
 */
export type XPublishOutcome =
  | { status: "published"; post: Post }
  | { status: "failed"; post: Post }
  | { status: "needs_confirmation"; post: Post };

async function setAttempt(
  env: Env,
  postId: string,
  outcome: "published" | "failed" | "unknown",
  detail: string | null,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO post_attempts (id, post_id, attempted_at, outcome, detail) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), postId, nowIso(), outcome, detail)
    .run();
}

function base64(bytes: Uint8Array): string {
  let value = "";
  for (let index = 0; index < bytes.length; index += 32_766) {
    value += String.fromCharCode(...bytes.subarray(index, index + 32_766));
  }
  return btoa(value);
}

async function requirePost(env: Env, postId: string): Promise<Post> {
  const post = await getPost(env.DB, postId);
  if (!post) throw new Error(`post ${postId} vanished mid-publish`);
  return post;
}

/**
 * The single place that calls the X API for a post. The post MUST already be
 * claimed into `posting` by the caller — the cron's `claimAndPublish` or the
 * CLI's `publishNow` — so cron and CLI can never both post the same row. This
 * uploads media, posts the tweet, persists the terminal status plus a
 * `post_attempts` row, and returns the reloaded post. An X-side failure is
 * persisted as `failed` / `needs_confirmation` and returned, never thrown.
 */
export async function runXPublish(env: Env, postId: string): Promise<XPublishOutcome> {
  const claimed = await getPost(env.DB, postId);
  if (!claimed || claimed.status !== "posting") {
    throw new Error(
      `runXPublish requires a claimed post; ${postId} is ${claimed?.status ?? "missing"}`,
    );
  }
  try {
    const token = await accessTokenForAccount(env, claimed.xAccountId);
    const media = (await listPostMedia(env.DB, [postId]))[postId] ?? [];
    const mediaIds: string[] = [];
    for (const item of media) {
      const object = await env.MEDIA.get(item.r2Key);
      if (!object) throw new Error("Scheduled image was not found in storage");
      const bytes = new Uint8Array(await object.arrayBuffer());
      const upload = await fetch(`${env.X_API_BASE_URL}/2/media/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          media: base64(bytes),
          media_category: "tweet_image",
          media_type: item.contentType,
        }),
      });
      const uploadJson = await upload.json<{ data?: { id: string } }>();
      if (!upload.ok || !uploadJson.data)
        throw new Error(`X image upload failed (${upload.status})`);
      mediaIds.push(uploadJson.data.id);
      if (item.altText) {
        const metadata = await fetch(`${env.X_API_BASE_URL}/2/media/metadata`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            id: uploadJson.data.id,
            metadata: { alt_text: { text: item.altText } },
          }),
        });
        if (!metadata.ok) throw new Error(`X image alt text update failed (${metadata.status})`);
      }
    }
    const tagRows = await env.DB.prepare("SELECT x_user_id FROM post_media_tags WHERE post_id = ?")
      .bind(postId)
      .all<{ x_user_id: string }>();
    const body: { text: string; media?: { media_ids: string[]; tagged_user_ids?: string[] } } = {
      text: claimed.text,
    };
    if (mediaIds.length)
      body.media = {
        media_ids: mediaIds,
        ...(tagRows.results.length
          ? { tagged_user_ids: tagRows.results.map((row) => row.x_user_id) }
          : {}),
      };
    const response = await fetch(`${env.X_API_BASE_URL}/2/tweets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await response.json<{ data?: { id: string }; detail?: string }>();
    if (!response.ok || !json.data)
      throw new Error(json.detail ?? `X post failed (${response.status})`);
    // Clear any prior failure_reason: `publishNow` retries `failed` /
    // `needs_confirmation` posts, so a successful retry must not leave a stale
    // reason that the dashboard would still render as a failure alert.
    await env.DB.prepare(
      "UPDATE posts SET status = 'published', published_x_post_id = ?, published_at = ?, updated_at = ?, failure_reason = NULL WHERE id = ? AND status = 'posting'",
    )
      .bind(json.data.id, nowIso(), nowIso(), postId)
      .run();
    await setAttempt(env, postId, "published", null);
    return { status: "published", post: await requirePost(env, postId) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const uncertain = /network|timeout|fetch failed/i.test(detail);
    const next = uncertain ? "needs_confirmation" : "failed";
    await env.DB.prepare(
      "UPDATE posts SET status = ?, failure_reason = ?, updated_at = ? WHERE id = ? AND status = 'posting'",
    )
      .bind(next, detail, nowIso(), postId)
      .run();
    await setAttempt(env, postId, uncertain ? "unknown" : "failed", detail);
    return { status: next, post: await requirePost(env, postId) };
  }
}
