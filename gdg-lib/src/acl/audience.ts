import type { PageAudienceSubject, SourceAudienceKey } from "./types";
import { isSourceVisibility, sourceVisibilityNeedsChapter } from "./visibility";

export function sourceAudienceKey(
  visibility: string,
  chapterId: string | null | undefined,
): SourceAudienceKey | null {
  if (!isSourceVisibility(visibility)) return null;
  if (sourceVisibilityNeedsChapter(visibility)) {
    if (!chapterId) return null;
    if (visibility === "chapter-member") return { kind: "chapter-member", chapterId };
    return { kind: "chapter-organizer", chapterId };
  }
  if (visibility === "private") return { kind: "private" };
  if (visibility === "member") return { kind: "member" };
  if (visibility === "organizer") return { kind: "organizer" };
  return null;
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
  if (isSourceVisibility(level) && !sourceVisibilityNeedsChapter(level)) {
    return sourceAudienceKey(level, null);
  }
  const match = /^(chapter-member|chapter-organizer):(.+)$/.exec(level.trim());
  if (!match) return null;
  return sourceAudienceKey(match[1], match[2]);
}
