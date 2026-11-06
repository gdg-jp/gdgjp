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
