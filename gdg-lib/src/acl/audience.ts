import type { PageAudienceSubject, SourceAudienceKey } from "./types";

export function sourceAudienceKey(
  visibility: string,
  chapterId: string | null | undefined,
): SourceAudienceKey | null {
  switch (visibility) {
    case "private":
      return { kind: "private" };
    case "member":
      return { kind: "member" };
    case "organizer":
      return { kind: "organizer" };
    case "chapter-member":
      return chapterId ? { kind: "chapter-member", chapterId } : null;
    case "chapter-organizer":
      return chapterId ? { kind: "chapter-organizer", chapterId } : null;
    default:
      return null;
  }
}

/** Proven inclusions only: A(page) ⊆ A(source). */
export function audienceContains(
  source: SourceAudienceKey | string,
  page: PageAudienceSubject,
): boolean {
  const key = typeof source === "string" ? parseLevelAudienceKey(source) : source;
  if (!key) return false;
  if (page.visibility === "public" || page.visibility === "unlisted") return false;

  const hasEmailGrant = page.access.some((entry) => entry.subjectType === "email");
  const chapterGrants = page.access.filter((entry) => entry.subjectType === "chapter");

  switch (key.kind) {
    case "private":
      return false;
    case "member":
      if (page.visibility === "member" || page.visibility === "organizer") return true;
      if (page.visibility === "restricted" && !hasEmailGrant && chapterGrants.length > 0) {
        return true;
      }
      return false;
    case "organizer":
      return page.visibility === "organizer";
    case "chapter-member":
      if (page.visibility !== "restricted" || hasEmailGrant || chapterGrants.length === 0) {
        return false;
      }
      return chapterGrants.every((entry) => entry.subjectKey === key.chapterId);
    case "chapter-organizer":
      return false;
    default:
      return false;
  }
}

export function parseLevelAudienceKey(level: string): SourceAudienceKey | null {
  if (level === "private" || level === "member" || level === "organizer") {
    return sourceAudienceKey(level, null);
  }
  const match = /^(chapter-member|chapter-organizer):(.+)$/.exec(level.trim());
  if (!match) return null;
  return sourceAudienceKey(match[1], match[2]);
}
