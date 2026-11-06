const KIND_ABBR: Record<string, string> = {
  x_post: "x",
  live_post: "live",
  ig_post: "ig",
  connpass_mail: "mail",
  discord_post: "dc",
};

export const SHORTLINK_PLACEHOLDER = "{{shortlink}}";
const MAX = 40;

/** `<campaign>-<kind>-<item id>`, at most 40 characters (the campaign part is cut). */
export function shortlinkSlug(campaignSlug: string, kind: string, itemId: number): string {
  const tail = `-${KIND_ABBR[kind] ?? "p"}-${itemId}`;
  const head = campaignSlug.slice(0, Math.max(1, MAX - tail.length)).replace(/-+$/, "");
  return `${head}${tail}`;
}

/** The text that goes out: the stored draft keeps the placeholder. */
export function withShortlink(text: string, shortUrl: string | null): string {
  return shortUrl ? text.split(SHORTLINK_PLACEHOLDER).join(shortUrl) : text;
}

export const hasShortlink = (text: string) => text.includes(SHORTLINK_PLACEHOLDER);
