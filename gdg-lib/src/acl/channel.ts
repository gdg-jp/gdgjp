import type { PageSubject, PermissionClass, SourceAudienceKey } from "./types";

/** The decision table proves A(channel = outer) ⊆ A(source = inner). */
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
  const sourceKey = sourceKeyForChannel(source.visibility, source.chapterId);
  return (
    sourceKey !== null &&
    classesCanAccessSource(source, classes) &&
    audienceKeyContains(channel, sourceKey)
  );
}

export function canClassesSeePageInChannel(
  page: PageSubject,
  classes: readonly PermissionClass[],
  channel: SourceAudienceKey,
): boolean {
  return classesCanSeePage(page, classes) && pageAudienceIncludesChannel(page, channel);
}

function sourceKeyForChannel(
  visibility: string,
  chapterId: string | null,
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

function classesCanAccessSource(
  source: { visibility: string; chapterId: string | null },
  classes: readonly PermissionClass[],
): boolean {
  switch (source.visibility) {
    case "member":
      return classes.length > 0;
    case "organizer":
      return classes.some((permissionClass) => permissionClass.role === "organizer");
    case "chapter-member":
      return classes.some(
        (permissionClass) => String(permissionClass.chapterId) === source.chapterId,
      );
    case "chapter-organizer":
      return classes.some(
        (permissionClass) =>
          String(permissionClass.chapterId) === source.chapterId &&
          permissionClass.role === "organizer",
      );
    default:
      return false;
  }
}

function classesCanSeePage(page: PageSubject, classes: readonly PermissionClass[]): boolean {
  switch (page.visibility) {
    case "public":
    case "unlisted":
      return true;
    case "member":
      return classes.length > 0;
    case "organizer":
      return classes.some((permissionClass) => permissionClass.role === "organizer");
    case "restricted":
      return page.access.some(
        (entry) =>
          entry.subjectType === "chapter" &&
          classes.some((permissionClass) => String(permissionClass.chapterId) === entry.subjectKey),
      );
    default:
      return false;
  }
}
