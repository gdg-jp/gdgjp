import { useEffect, useRef, useState } from "react";
import { Form, useFetcher } from "react-router";
import { GooglePhotoButton } from "~/features/google-photos/components/google-photo-button";
import { attachLibraryPhotos, loadPhotoLibrary } from "~/features/google-photos/library.server";
import { AppShell } from "~/layouts/app-shell";
import type { Route } from "./+types/library";

export function loader({ request, context }: Route.LoaderArgs) {
  return loadPhotoLibrary(request, context.cloudflare.env);
}

export function action({ request, context }: Route.ActionArgs) {
  return attachLibraryPhotos(request, context.cloudflare.env);
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
