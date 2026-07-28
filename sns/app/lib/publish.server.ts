import { getPost, getXAccount, listPostMedia } from "~/lib/db.server";
import { nowIso } from "~/lib/utils";
import { accessTokenForAccount } from "~/lib/x.server";

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

async function postToX(env: Env, postId: string): Promise<void> {
  const post = await getPost(env.DB, postId);
  if (!post || post.status !== "posting") return;
  try {
    const token = await accessTokenForAccount(env, post.xAccountId);
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
      text: post.text,
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
    await env.DB.prepare(
      "UPDATE posts SET status = 'published', published_x_post_id = ?, published_at = ?, updated_at = ? WHERE id = ? AND status = 'posting'",
    )
      .bind(json.data.id, nowIso(), nowIso(), postId)
      .run();
    await setAttempt(env, postId, "published", null);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const uncertain = /network|timeout|fetch failed/i.test(detail);
    await env.DB.prepare(
      "UPDATE posts SET status = ?, failure_reason = ?, updated_at = ? WHERE id = ? AND status = 'posting'",
    )
      .bind(uncertain ? "needs_confirmation" : "failed", detail, nowIso(), postId)
      .run();
    await setAttempt(env, postId, uncertain ? "unknown" : "failed", detail);
  }
}

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
  if (claim.meta.changes === 1) await postToX(env, post.id);
}

export async function publishDuePosts(env: Env): Promise<void> {
  const due = await env.DB.prepare(
    "SELECT id FROM posts WHERE status IN ('scheduled', 'waiting_for_photo') AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 50",
  )
    .bind(nowIso())
    .all<{ id: string }>();
  for (const row of due.results) await claimAndPublish(env, row.id);
}
