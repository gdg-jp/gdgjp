import { decode } from "blurhash";
import { useEffect, useRef, useState } from "react";
import { Form, data, redirect, useFetcher } from "react-router";
import { AppShell } from "~/components/app-shell";
import { requireSnsAccess } from "~/lib/access.server";
import { getPost, listGooglePhotosLibraryMedia, listPostMedia } from "~/lib/db.server";
import { claimAndPublish } from "~/lib/publish.server";
import { MAX_IMAGES, nowIso } from "~/lib/utils";
import type { Route } from "./+types/google.photos.library";

export async function loader({ request, context }: Route.LoaderArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  const postId = new URL(request.url).searchParams.get("postId");
  const post = postId ? await getPost(context.cloudflare.env.DB, postId) : null;
  if (!post || post.chapterId !== access.chapter.chapterId)
    throw new Response("Not found", { status: 404 });
  const cursor = new URL(request.url).searchParams.get("cursor");
  const library = await listGooglePhotosLibraryMedia(
    context.cloudflare.env.DB,
    access.chapter.chapterId,
    {
      cursor,
    },
  );
  return {
    ...access,
    post,
    ...library,
    remaining:
      MAX_IMAGES -
      ((await listPostMedia(context.cloudflare.env.DB, [post.id]))[post.id] ?? []).length,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireSnsAccess(env, request);
  const form = await request.formData();
  const postId = String(form.get("postId") ?? "");
  const post = await getPost(env.DB, postId);
  if (!post || post.chapterId !== access.chapter.chapterId)
    throw new Response("Not found", { status: 404 });
  if (["published", "posting"].includes(post.status))
    return data({ error: "投稿済みの投稿には画像を追加できません。" }, { status: 409 });
  const selectedIds = [...new Set(form.getAll("mediaId").map(String))];
  const existing = (await listPostMedia(env.DB, [post.id]))[post.id] ?? [];
  if (!selectedIds.length || selectedIds.length > MAX_IMAGES - existing.length)
    return data({ error: "選択できる画像数を確認してください。" }, { status: 400 });
  const placeholders = selectedIds.map(() => "?").join(",");
  const selected = await env.DB.prepare(
    `SELECT m.id, m.r2_key, m.content_type, m.byte_size
     FROM google_photos_media m JOIN google_photos_albums a ON a.id = m.album_id
     WHERE a.chapter_id = ? AND m.id IN (${placeholders})`,
  )
    .bind(access.chapter.chapterId, ...selectedIds)
    .all<{ id: string; r2_key: string; content_type: string; byte_size: number }>();
  if (selected.results.length !== selectedIds.length)
    return data({ error: "選択した画像が見つかりません。" }, { status: 404 });
  for (const [index, item] of selected.results.entries()) {
    const source = await env.MEDIA.get(item.r2_key);
    if (!source) return data({ error: "保存済み画像が見つかりません。" }, { status: 409 });
    const key = `${post.chapterId}/${post.id}/${crypto.randomUUID()}`;
    await env.MEDIA.put(key, source.body, { httpMetadata: { contentType: item.content_type } });
    await env.DB.prepare(
      "INSERT INTO post_media (id, post_id, r2_key, content_type, byte_size, alt_text, sort_order, created_at) VALUES (?, ?, ?, ?, ?, '', ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        post.id,
        key,
        item.content_type,
        item.byte_size,
        existing.length + index,
        nowIso(),
      )
      .run();
  }
  await claimAndPublish(env, post.id);
  throw redirect(`/schedule?edit=${post.id}`);
}

function BlurhashPlaceholder({ hash, isSelected }: { hash: string | null; isSelected: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!hash || !canvasRef.current) return;
    try {
      const width = 32;
      const pixels = decode(hash, width, width);
      const context = canvasRef.current.getContext("2d");
      if (!context) return;
      const image = new ImageData(width, width);
      image.data.set(pixels);
      context.putImageData(image, 0, 0);
    } catch {
      // An invalid placeholder must not prevent loading the original image.
    }
  }, [hash]);

  return hash ? (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 size-full object-cover blur-sm transition-transform duration-200 ${isSelected ? "scale-90" : "scale-100"}`}
      height="32"
      width="32"
    />
  ) : null;
}

function GooglePhotoButton({
  id,
  blurhash,
  selectionIndex,
  onToggle,
}: {
  id: string;
  blurhash: string | null;
  selectionIndex: number;
  onToggle: () => void;
}) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const isSelected = selectionIndex !== -1;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isSelected}
      aria-label={isSelected ? `写真 ${selectionIndex + 1} を選択解除` : "写真を選択"}
      className="relative aspect-square overflow-hidden bg-muted focus-visible:z-10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring"
    >
      <BlurhashPlaceholder hash={blurhash} isSelected={isSelected} />
      <img
        src={`/api/google-photos-media/${id}`}
        alt=""
        loading="lazy"
        onLoad={() => setImageLoaded(true)}
        onError={() => setImageLoaded(true)}
        className={`size-full object-cover transition-[opacity,transform] duration-200 ${imageLoaded ? "opacity-100" : "opacity-0"} ${isSelected ? "scale-90" : "scale-100"}`}
      />
      {isSelected ? (
        <>
          <span className="absolute inset-0 bg-black/45" aria-hidden="true" />
          <span className="absolute top-2 left-2 flex size-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-white shadow">
            {selectionIndex + 1}
          </span>
        </>
      ) : null}
    </button>
  );
}

export default function GooglePhotosLibrary({ loaderData, actionData }: Route.ComponentProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [media, setMedia] = useState(loaderData.media);
  const [nextCursor, setNextCursor] = useState(loaderData.nextCursor);
  const moreMedia = useFetcher<Pick<typeof loaderData, "media" | "nextCursor">>();
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadedMedia = moreMedia.data;
    if (!loadedMedia) return;
    setMedia((current) => {
      const known = new Set(current.map((item) => item.id));
      return [...current, ...loadedMedia.media.filter((item) => !known.has(item.id))];
    });
    setNextCursor(loadedMedia.nextCursor);
  }, [moreMedia.data]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !nextCursor) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || moreMedia.state !== "idle") return;
        const params = new URLSearchParams({
          postId: loaderData.post.id,
          cursor: nextCursor,
        });
        moreMedia.load(`/google/photos/library?${params}`);
      },
      { rootMargin: "400px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loaderData.post.id, moreMedia, nextCursor]);

  function toggleSelection(mediaId: string) {
    setSelectedIds((current) => {
      if (current.includes(mediaId)) return current.filter((id) => id !== mediaId);
      return current.length < loaderData.remaining ? [...current, mediaId] : current;
    });
  }

  return (
    <AppShell
      user={loaderData.user}
      chapter={loaderData.chapter}
      chapters={loaderData.chapters}
      showFab={false}
    >
      <Form method="post" className="space-y-4 pb-24">
        <input type="hidden" name="postId" value={loaderData.post.id} />
        <div className="space-y-1 px-4 pt-4">
          <h1 className="text-xl font-bold">Google Photos の写真</h1>
          <p className="text-sm text-muted-foreground">
            最大 {loaderData.remaining} 枚選択できます。
          </p>
          {actionData?.error ? <p className="text-sm text-red-500">{actionData.error}</p> : null}
        </div>
        {selectedIds.map((mediaId) => (
          <input key={mediaId} type="hidden" name="mediaId" value={mediaId} />
        ))}
        {media.length ? (
          <div className="grid grid-cols-3">
            {media.map((item) => {
              const selectionIndex = selectedIds.indexOf(item.id);
              return (
                <GooglePhotoButton
                  key={item.id}
                  id={item.id}
                  blurhash={item.blurhash}
                  selectionIndex={selectionIndex}
                  onToggle={() => toggleSelection(item.id)}
                />
              );
            })}
          </div>
        ) : (
          <p className="px-4 text-sm text-muted-foreground">まだ取り込まれた写真はありません。</p>
        )}
        {nextCursor ? (
          <div ref={loadMoreRef} className="py-4 text-center text-sm text-muted-foreground">
            {moreMedia.state === "loading" ? "写真を読み込んでいます…" : "さらに写真を読み込みます"}
          </div>
        ) : null}
        <button
          disabled={!selectedIds.length}
          className="fixed inset-x-4 bottom-20 z-30 mx-auto max-w-[calc(28rem-2rem)] rounded-full bg-primary px-5 py-3 font-bold text-white shadow-lg disabled:opacity-50"
          type="submit"
        >
          選択した写真を追加
        </button>
      </Form>
    </AppShell>
  );
}
