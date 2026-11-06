/** The parts of a draft version that delivery needs (pr-x-post's first post). */
export type DeliverablePost = {
  text: string;
  attachmentKind: "image" | "ogp" | "none";
  linkUrl: string | null;
  ogImage: string | null;
  staffReminderText: string | null;
};

type PostLike = {
  text?: unknown;
  attachment?: { kind?: unknown; link?: { url?: unknown; ogImage?: unknown } | null } | null;
  staffReminder?: { text?: unknown } | null;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export function deliverablePost(content: unknown): DeliverablePost | null {
  const root = content as { posts?: PostLike[]; text?: unknown; body?: unknown } | null;
  const post = root?.posts?.[0];
  const text = str(post?.text) ?? str(root?.text) ?? str(root?.body);
  if (!text) return null;
  const kind = post?.attachment?.kind;
  return {
    text,
    attachmentKind: kind === "image" || kind === "ogp" ? kind : "none",
    linkUrl: str(post?.attachment?.link?.url),
    ogImage: str(post?.attachment?.link?.ogImage),
    staffReminderText: str(post?.staffReminder?.text),
  };
}

/** Reasons a draft cannot be approved for delivery (OGP-ON-SHORTLINK, a link with no target). */
export function approvalBlockers(
  post: DeliverablePost | null,
  fallbackUrl: string | null,
): string[] {
  if (!post) return [];
  const out: string[] = [];
  if (post.attachmentKind === "ogp" && !post.ogImage)
    out.push("OGP カードで出す投稿に OGP 画像の URL がありません（OGP-ON-SHORTLINK）");
  if (post.text.includes("{{shortlink}}") && !post.linkUrl && !fallbackUrl)
    out.push(
      "短縮リンクの宛先がありません（リンク URL か brief の connpass URL を入れてください）",
    );
  return out;
}

/** The ISO instant sns expects. */
export const isoAt = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();

/** JST wall time for messages, e.g. 12/01 18:00. */
export function jstLabel(unixSeconds: number): string {
  const d = new Date((unixSeconds + 9 * 3600) * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
