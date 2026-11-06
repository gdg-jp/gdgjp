// Client-safe space vocabulary. Server logic lives in *.server.ts beside this file.

export const DEFAULT_SPACE_ID = "gdg-jp";
export const DEFAULT_SPACE_SLUG = "gdg-jp";

export type SpaceKind = "personal" | "chapter" | "shared";
export type SpaceRole = "owner" | "editor" | "viewer";
export type PrincipalType = "user" | "public" | "chapter_role" | "discord_guild" | "chat_space";

export const SPACE_ROLE_RANK: Record<SpaceRole, number> = { viewer: 1, editor: 2, owner: 3 };

export function isSpaceRole(value: unknown): value is SpaceRole {
  return value === "owner" || value === "editor" || value === "viewer";
}

export function strongerRole(a: SpaceRole | undefined, b: SpaceRole): SpaceRole {
  if (!a) return b;
  return SPACE_ROLE_RANK[a] >= SPACE_ROLE_RANK[b] ? a : b;
}

export function roleAtLeast(role: SpaceRole | null | undefined, min: SpaceRole): boolean {
  return !!role && SPACE_ROLE_RANK[role] >= SPACE_ROLE_RANK[min];
}

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/** Prefixes reserved for system-assigned slugs (`u-<userId>`, `c-<chapterId>`). */
const RESERVED_PREFIXES = ["u-", "c-"];

export function isValidSpaceSlug(slug: string): boolean {
  return slug.length >= 2 && SLUG_PATTERN.test(slug);
}

/** Shared spaces may not take slugs that look like personal / chapter spaces. */
export function isValidSharedSpaceSlug(slug: string): boolean {
  return (
    isValidSpaceSlug(slug) &&
    slug !== DEFAULT_SPACE_SLUG &&
    !RESERVED_PREFIXES.some((prefix) => slug.startsWith(prefix))
  );
}

export function personalSpaceSlug(userId: string): string {
  return `u-${userId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`.slice(0, 40).replace(/-+$/, "");
}

export function chapterSpaceSlug(chapterId: string): string {
  return `c-${chapterId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`.slice(0, 40).replace(/-+$/, "");
}

/**
 * Which principal types a space kind accepts. Chapter and personal spaces have a fixed
 * membership written at creation; nothing may widen it (Stage 01 §2-b). Enforced on the
 * server in members.server.ts, not only by hiding UI.
 */
export const ALLOWED_PRINCIPALS: Record<SpaceKind, readonly PrincipalType[]> = {
  personal: [],
  chapter: [],
  shared: ["user", "chapter_role", "discord_guild", "chat_space"],
};

/** URL of a space-scoped screen. */
export function spacePath(spaceSlug: string, rest = ""): string {
  const suffix = rest ? (rest.startsWith("/") ? rest : `/${rest}`) : "";
  return `/s/${encodeURIComponent(spaceSlug)}${suffix}`;
}
