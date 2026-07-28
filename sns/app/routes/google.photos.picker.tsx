import { Form, data, redirect } from "react-router";
import { AppShell } from "~/components/app-shell";
import { requireSnsAccess } from "~/lib/access.server";
import { decryptSecret } from "~/lib/crypto.server";
import { getPost, listPostMedia } from "~/lib/db.server";
import { claimAndPublish } from "~/lib/publish.server";
import { MAX_IMAGES, nowIso } from "~/lib/utils";
import type { Route } from "./+types/google.photos.picker";

type TokenRow = { access_token_ciphertext: string; expires_at: string | null };
type PickerSession = { id?: string; pickerUri?: string; expireTime?: string };
type PickedItems = {
  mediaItems?: { id: string; mediaFile?: { baseUrl: string; mimeType: string } }[];
};

async function tokenForUser(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT access_token_ciphertext, expires_at FROM google_photos_tokens WHERE user_id = ?",
  )
    .bind(userId)
    .first<TokenRow>();
  if (!row || (row.expires_at && new Date(row.expires_at).getTime() <= Date.now() + 60_000))
    return null;
  return decryptSecret(env.TOKEN_ENCRYPTION_KEY, row.access_token_ciphertext);
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireSnsAccess(env, request);
  const postId = new URL(request.url).searchParams.get("postId");
  const post = postId ? await getPost(env.DB, postId) : null;
  if (!post || post.chapterId !== access.chapter.chapterId)
    throw new Response("Not found", { status: 404 });
  const token = await tokenForUser(env, access.user.id);
  if (!token) throw redirect(`/google/photos/connect?postId=${post.id}`);
  const existing = await env.DB.prepare(
    "SELECT id, picker_uri FROM google_picker_sessions WHERE post_id = ? AND user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(post.id, access.user.id, nowIso())
    .first<{ id: string; picker_uri: string }>();
  if (existing) return { ...access, post, picker: { id: existing.id, uri: existing.picker_uri } };
  const response = await fetch("https://photospicker.googleapis.com/v1/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ pickingConfig: { maxItemCount: MAX_IMAGES } }),
  });
  const session = await response.json<PickerSession>();
  if (!response.ok || !session.id || !session.pickerUri)
    throw new Response("Google Photos Picker session could not be created", { status: 502 });
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO google_picker_sessions (id, post_id, user_id, google_session_id, picker_uri, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      post.id,
      access.user.id,
      session.id,
      session.pickerUri,
      session.expireTime ?? new Date(Date.now() + 3_600_000).toISOString(),
      nowIso(),
    )
    .run();
  return { ...access, post, picker: { id, uri: session.pickerUri } };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireSnsAccess(env, request);
  const form = await request.formData();
  const id = String(form.get("pickerId") ?? "");
  const session = await env.DB.prepare(
    "SELECT post_id, google_session_id FROM google_picker_sessions WHERE id = ? AND user_id = ? AND expires_at > ?",
  )
    .bind(id, access.user.id, nowIso())
    .first<{ post_id: string; google_session_id: string }>();
  if (!session)
    return data(
      { error: "選択セッションの有効期限が切れました。もう一度開いてください。" },
      { status: 400 },
    );
  const post = await getPost(env.DB, session.post_id);
  if (!post || post.chapterId !== access.chapter.chapterId)
    throw new Response("Forbidden", { status: 403 });
  const token = await tokenForUser(env, access.user.id);
  if (!token) throw redirect(`/google/photos/connect?postId=${post.id}`);
  const status = await fetch(
    `https://photospicker.googleapis.com/v1/sessions/${encodeURIComponent(session.google_session_id)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const statusJson = await status.json<{ mediaItemsSet?: boolean }>();
  if (!status.ok || !statusJson.mediaItemsSet)
    return data(
      { error: "Google Photos で写真を選択してから、もう一度読み込んでください。" },
      { status: 400 },
    );
  const selected = await fetch(
    `https://photospicker.googleapis.com/v1/mediaItems?sessionId=${encodeURIComponent(session.google_session_id)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const selectedJson = await selected.json<PickedItems>();
  const existing = (await listPostMedia(env.DB, [post.id]))[post.id] ?? [];
  const items = (selectedJson.mediaItems ?? [])
    .filter((item) => item.mediaFile?.mimeType.startsWith("image/"))
    .slice(0, MAX_IMAGES - existing.length);
  if (!selected.ok || items.length === 0)
    return data({ error: "追加できる画像がありません。" }, { status: 400 });
  for (const [index, item] of items.entries()) {
    const source = await fetch(`${item.mediaFile?.baseUrl}=d`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!source.ok || !source.body) continue;
    const key = `${post.chapterId}/${post.id}/${crypto.randomUUID()}`;
    await env.MEDIA.put(key, source.body, {
      httpMetadata: { contentType: item.mediaFile?.mimeType },
    });
    const size = Number(source.headers.get("content-length") ?? 0);
    await env.DB.prepare(
      "INSERT INTO post_media (id, post_id, r2_key, content_type, byte_size, alt_text, sort_order, created_at) VALUES (?, ?, ?, ?, ?, '', ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        post.id,
        key,
        item.mediaFile?.mimeType ?? "image/jpeg",
        size,
        existing.length + index,
        nowIso(),
      )
      .run();
  }
  await env.DB.prepare("DELETE FROM google_picker_sessions WHERE id = ?").bind(id).run();
  await claimAndPublish(env, post.id);
  throw redirect(`/schedule?edit=${post.id}`);
}

export default function GooglePhotosPicker({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <AppShell user={loaderData.user} chapter={loaderData.chapter} chapters={loaderData.chapters}>
      <div className="space-y-4 p-5">
        <h1 className="text-xl font-bold">Google Photos から追加</h1>
        <p className="text-sm text-muted-foreground">
          Google Photosを別タブで開いて、投稿に添付する写真を最大4枚選択してください。
        </p>
        <a
          className="block rounded-full bg-primary px-5 py-3 text-center font-bold text-white"
          href={`${loaderData.picker.uri}/autoclose`}
          target="_blank"
          rel="noreferrer"
        >
          Google Photos を開く
        </a>
        <Form method="post">
          <input type="hidden" name="pickerId" value={loaderData.picker.id} />
          {actionData?.error ? (
            <p className="my-3 text-sm text-red-500">{actionData.error}</p>
          ) : null}
          <button type="submit" className="w-full rounded-full border px-5 py-3 font-bold">
            選択した写真を読み込む
          </button>
        </Form>
      </div>
    </AppShell>
  );
}
