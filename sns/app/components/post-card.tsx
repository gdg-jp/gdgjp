import { ExternalLink } from "lucide-react";
import type { Post, PostMedia, XAccount } from "~/lib/db.server";

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
}: { post: Post; account: XAccount | undefined; media: PostMedia[] }) {
  return (
    <article className="border-b px-4 py-3">
      <div className="flex gap-3">
        <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-muted font-semibold">
          {account?.profileImageUrl ? (
            <img src={account.profileImageUrl} alt="" className="size-full object-cover" />
          ) : (
            "X"
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1">
            <strong className="truncate">{account?.displayName ?? "X account"}</strong>
            <span className="truncate text-sm text-muted-foreground">
              @{account?.username ?? "unknown"}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[15px] leading-5 post-text">
            {textWithLinks(post.text)}
          </p>
          {media.length ? (
            <div
              className={`mt-3 grid overflow-hidden rounded-2xl border ${media.length > 1 ? "grid-cols-2 gap-0.5" : "grid-cols-1"}`}
            >
              {media.map((image) => (
                <img
                  key={image.id}
                  src={`/api/media/${image.id}`}
                  alt={image.altText}
                  className="aspect-square w-full object-cover"
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
        </div>
      </div>
    </article>
  );
}
