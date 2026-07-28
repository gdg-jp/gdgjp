import { ExternalLink, ImagePlus, Pencil } from "lucide-react";
import { useEffect } from "react";
import { Link, useFetcher, useNavigate, useRevalidator } from "react-router";
import type { Post, PostMedia, XAccount } from "~/lib/db.server";
import googlePhotosLogo from "../../photos.png";

function textWithLinks(text: string) {
  const tokens = text.split(/(https?:\/\/[^\s]+|@[A-Za-z0-9_]+|#[\p{L}\p{N}_]+)/gu);
  const seen = new Map<string, number>();
  return tokens.map((token) => {
    const occurrence = seen.get(token) ?? 0;
    seen.set(token, occurrence + 1);
    const key = `${token}-${occurrence}`;
    return /^(https?:\/\/|@|#)/.test(token) ? (
      <a key={key} href={token.startsWith("http") ? token : undefined}>
        {token}
      </a>
    ) : (
      <span key={key}>{token}</span>
    );
  });
}
export function PostCard({
  post,
  account,
  media,
  editHref,
}: {
  post: Post;
  account: XAccount | undefined;
  media: PostMedia[];
  editHref?: string;
}) {
  const mediaFetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const canAddMedia = !["published", "posting"].includes(post.status) && media.length < 4;
  const isInteractiveTarget = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(target.closest("a[href], button, input, label, select, textarea"));

  const openEditor = () => {
    if (editHref) navigate(editHref);
  };

  useEffect(() => {
    if (mediaFetcher.data?.ok) revalidator.revalidate();
  }, [mediaFetcher.data?.ok, revalidator]);

  return (
    <article
      className={`border-b px-4 py-3 ${
        editHref
          ? "cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
          : ""
      }`}
      onClick={(event) => {
        if (!isInteractiveTarget(event.target)) openEditor();
      }}
      onKeyDown={(event) => {
        if (isInteractiveTarget(event.target)) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openEditor();
        }
      }}
      role={editHref ? "link" : undefined}
      tabIndex={editHref ? 0 : undefined}
    >
      <div className="flex gap-3">
        <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-muted font-semibold">
          {account?.profileImageUrl ? (
            <img src={account.profileImageUrl} alt="" className="size-full object-cover" />
          ) : (
            "X"
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <strong className="truncate">{account?.displayName ?? "X account"}</strong>
            <span className="truncate text-sm text-muted-foreground">
              @{account?.username ?? "unknown"}
            </span>
            {editHref ? (
              <Link
                className="grid size-7 shrink-0 place-items-center rounded-full text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                to={editHref}
                aria-label="投稿を編集"
                title="投稿を編集"
              >
                <Pencil className="size-4" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[15px] leading-5 post-text">
            {textWithLinks(post.text)}
          </p>
          {media.length ? (
            <div className="mt-3 flex gap-1 overflow-x-auto">
              {media.map((image) => (
                <img
                  key={image.id}
                  src={`/api/media/${image.id}`}
                  alt={image.altText}
                  className="size-24 shrink-0 rounded-xl border object-cover"
                />
              ))}
            </div>
          ) : post.linkPreviewUrl ? (
            <a
              className="mt-3 block overflow-hidden rounded-2xl border"
              href={post.linkPreviewUrl}
              target="_blank"
              rel="noreferrer"
            >
              {post.linkPreviewImageUrl ? (
                <img
                  src={post.linkPreviewImageUrl}
                  alt=""
                  className="aspect-[1.91] w-full object-cover"
                />
              ) : (
                <div className="grid aspect-[1.91] place-items-center bg-muted">
                  <ExternalLink />
                </div>
              )}
              <div className="p-3">
                <p className="text-sm text-muted-foreground">
                  {new URL(post.linkPreviewUrl).hostname}
                </p>
                <p className="line-clamp-2 font-medium">
                  {post.linkPreviewTitle ?? post.linkPreviewUrl}
                </p>
                {post.linkPreviewDescription ? (
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {post.linkPreviewDescription}
                  </p>
                ) : null}
              </div>
            </a>
          ) : null}
          {canAddMedia ? (
            <div className="mt-3">
              <div className="flex items-center gap-1">
                <mediaFetcher.Form method="post" action="/api/posts" encType="multipart/form-data">
                  <input type="hidden" name="intent" value="add_media" />
                  <input type="hidden" name="postId" value={post.id} />
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-full px-3 py-2 text-sm text-primary hover:bg-muted">
                    <ImagePlus className="size-4" aria-hidden="true" />
                    {mediaFetcher.state === "submitting" ? "画像を追加中…" : "画像を追加"}
                    <input
                      name="images"
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      disabled={mediaFetcher.state !== "idle"}
                      onChange={(event) => event.currentTarget.form?.requestSubmit()}
                    />
                  </label>
                </mediaFetcher.Form>
                <Link
                  to={`/google/photos/library?postId=${post.id}`}
                  className="inline-flex size-10 items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-primary/50"
                  aria-label="Google Photos から写真を選ぶ"
                  title="Google Photos から選ぶ"
                >
                  <img src={googlePhotosLogo} alt="" className="size-6" />
                </Link>
              </div>
              {mediaFetcher.data?.error ? (
                <p
                  className="mt-1 animate-in fade-in-0 zoom-in-95 text-xs text-red-600 animation-duration-150 ease-out motion-reduce:animation-duration-100"
                  role="alert"
                >
                  {mediaFetcher.data.error}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {new Intl.DateTimeFormat("ja-JP", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Tokyo",
              }).format(new Date(post.scheduledAt))}
            </span>
            <span>
              {post.condition === "scheduled" ? "指定時刻に投稿" : "写真が添付されたら投稿"}
            </span>
            <span
              className={
                post.status === "published"
                  ? "text-green-600"
                  : post.status.includes("failed")
                    ? "text-red-500"
                    : ""
              }
            >
              {post.status}
            </span>
          </div>
          {post.failureReason ? (
            <p className="mt-2 text-xs text-red-600" role="alert">
              投稿に失敗しました: {post.failureReason}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
