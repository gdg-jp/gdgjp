import { canClassesAccessSource, canClassesSeePage } from "./access";
import { sourceAudienceKey } from "./audience";
import type { PageSubject, PermissionClass, SourceAudienceKey } from "./types";

/** A(inner) ⊆ A(outer), proven by the channel audience decision table. */
export function audienceKeyContains(outer: SourceAudienceKey, inner: SourceAudienceKey): boolean {
  switch (outer.kind) {
    case "chapter-organizer":
      return (
        inner.kind === "member" ||
        inner.kind === "organizer" ||
        (inner.kind === "chapter-member" && inner.chapterId === outer.chapterId) ||
        (inner.kind === "chapter-organizer" && inner.chapterId === outer.chapterId)
      );
    case "chapter-member":
      return (
        inner.kind === "member" ||
        (inner.kind === "chapter-member" && inner.chapterId === outer.chapterId)
      );
    case "organizer":
      return inner.kind === "member" || inner.kind === "organizer";
    case "member":
      return inner.kind === "member";
    case "private":
      return false;
    default:
      return false;
  }
}

/** Whether A(channel) ⊆ A(page), with only representable page audiences accepted. */
export function pageAudienceIncludesChannel(
  page: PageSubject,
  channel: SourceAudienceKey,
): boolean {
  if (page.visibility === "public" || page.visibility === "unlisted") return true;

  switch (page.visibility) {
    case "member":
      return (
        channel.kind === "member" ||
        channel.kind === "organizer" ||
        channel.kind === "chapter-member" ||
        channel.kind === "chapter-organizer"
      );
    case "organizer":
      return channel.kind === "organizer" || channel.kind === "chapter-organizer";
    case "restricted": {
      const chapterGrants = page.access.filter((entry) => entry.subjectType === "chapter");
      const hasEmailGrant = page.access.some((entry) => entry.subjectType === "email");
      if (hasEmailGrant || chapterGrants.length !== 1) return false;
      const grant = chapterGrants[0];
      if (!grant) return false;
      return (
        (channel.kind === "chapter-member" || channel.kind === "chapter-organizer") &&
        grant.subjectKey === channel.chapterId
      );
    }
    default:
      return false;
  }
}

export function canClassesAccessSourceInChannel(
  source: { visibility: string; chapterId: string | null },
  classes: readonly PermissionClass[],
  channel: SourceAudienceKey,
): boolean {
  const sourceKey = sourceAudienceKey(source.visibility, source.chapterId);
  return (
    sourceKey !== null &&
    canClassesAccessSource(source, classes) &&
    audienceKeyContains(channel, sourceKey)
  );
}

export function canClassesSeePageInChannel(
  page: PageSubject,
  classes: readonly PermissionClass[],
  channel: SourceAudienceKey,
): boolean {
  return canClassesSeePage(page, classes) && pageAudienceIncludesChannel(page, channel);
}
