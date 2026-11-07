const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** Path segments under /c/ that would read like an app page. */
export const RESERVED_SLUGS = new Set([
  "new",
  "admin",
  "api",
  "settings",
  "me",
  "contacts",
  "playbook",
]);

export function normalizeSlug(raw: string | null | undefined): string | null {
  const slug = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!SLUG_RE.test(slug) || slug.includes("--") || RESERVED_SLUGS.has(slug)) return null;
  return slug;
}

/**
 * A URL for an event named by a person: its ASCII words, or `event-<date>` when the name has
 * none (Japanese names). `taken` adds -2, -3… until the slug is free.
 */
export function slugFromName(name: string, date: string, taken: (slug: string) => boolean): string {
  const words = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34)
    .replace(/-+$/, "");
  const base =
    normalizeSlug(words) ?? normalizeSlug(`event-${date.replaceAll("-", "")}`) ?? "event";
  if (!taken(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
