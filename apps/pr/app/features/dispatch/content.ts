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
  const root = content as {
    posts?: PostLike[];
    text?: unknown;
    body?: unknown;
    subject?: unknown;
    bodyLines?: unknown;
    footer?: unknown;
  } | null;
  const post = root?.posts?.[0];
  const mail = Array.isArray(root?.bodyLines)
    ? [root.bodyLines.join("\n"), str(root.footer)].filter(Boolean).join("\n\n")
    : null;
  const text = str(post?.text) ?? str(root?.text) ?? str(root?.body) ?? str(mail);
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

export const NO_TINYURL = "短縮リンクを作るには、設定でキャンペーンを有効化してください";

export function approvalBlockers(
  post: DeliverablePost | null,
  setup: { fallbackUrl: string | null; mediaUrl: string | null; tinyurlActive: boolean },
): string[] {
  if (!post) return [];
  const out: string[] = [];
  if (post.attachmentKind === "image" && !setup.mediaUrl)
    out.push("画像付きの投稿です。画像を承認する（か、添付する画像の URL を入れる）と承認できます");
  if (post.attachmentKind === "ogp" && !post.ogImage)
    out.push("OGP カードで出す投稿に OGP 画像の URL がありません（OGP-ON-SHORTLINK）");
  if (post.text.includes("{{shortlink}}") && !post.linkUrl && !setup.fallbackUrl)
    out.push(
      "短縮リンクの宛先がありません（リンク URL か brief の connpass URL を入れてください）",
    );
  if (post.text.includes("{{shortlink}}") && !setup.tinyurlActive) out.push(NO_TINYURL);
  return out;
}

export const isoAt = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();

export function jstLabel(unixSeconds: number): string {
  const d = new Date((unixSeconds + 9 * 3600) * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
