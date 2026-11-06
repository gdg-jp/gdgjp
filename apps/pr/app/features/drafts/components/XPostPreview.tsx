import { Badge } from "@gdgjp/design-system";

type Post = {
  purpose?: string;
  scheduledAt?: string;
  text?: string;
  textAboveFold?: string;
  textBelowFold?: string;
  expectedReaction?: string;
  attachment?: { kind?: string; link?: { url?: string; ogImage?: string | null } | null } | null;
  staffReminder?: { text?: string } | null;
  speakerRequest?: {
    speakerId?: string;
    purpose?: string;
    text?: string;
    suggestionOnly?: boolean;
  } | null;
};

/** An X post as it folds: the part above "さらに表示", a divider, then the hidden part. */
export function XPostPreview({ post }: { post: Post }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 text-sm">
        {post.purpose ? <Badge tone="neutral">{post.purpose}</Badge> : null}
        {post.expectedReaction ? <Badge tone="info">{post.expectedReaction}</Badge> : null}
        {post.attachment?.kind ? <Badge tone="neutral">添付: {post.attachment.kind}</Badge> : null}
        {post.scheduledAt ? <span className="text-muted">{post.scheduledAt}</span> : null}
      </div>
      <div className="max-w-xl rounded-lg border border-border p-4">
        <p className="whitespace-pre-wrap break-words">{post.textAboveFold ?? post.text}</p>
        {post.textBelowFold ? (
          <>
            <div className="my-2 border-t border-dashed border-border pt-1 text-xs text-muted">
              ここで「さらに表示」
            </div>
            <p className="whitespace-pre-wrap break-words text-muted">{post.textBelowFold}</p>
          </>
        ) : null}
      </div>
      {post.attachment?.link?.ogImage ? (
        <p className="text-sm text-muted">OGP: {post.attachment.link.ogImage}</p>
      ) : null}
      {post.staffReminder?.text ? (
        <p className="text-sm">スタッフへの依頼: {post.staffReminder.text}</p>
      ) : null}
      {post.speakerRequest?.text ? (
        <p className="text-sm">
          登壇者への依頼{post.speakerRequest.suggestionOnly ? "（提案のみ）" : ""}:{" "}
          {post.speakerRequest.text}
        </p>
      ) : null}
    </div>
  );
}
