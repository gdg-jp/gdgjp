import type {
  Membership,
  PageAudienceSubject,
  PageSubject,
  PermissionClass,
  SourceAudienceKey,
  SourceSubject,
  UserSubject,
} from "./types";

export type SourceVisibility =
  | "private"
  | "member"
  | "organizer"
  | "chapter-member"
  | "chapter-organizer";

export const SOURCE_VISIBILITIES: readonly SourceVisibility[] = [
  "private",
  "member",
  "organizer",
  "chapter-member",
  "chapter-organizer",
];

export function isSourceVisibility(value: unknown): value is SourceVisibility {
  return typeof value === "string" && (SOURCE_VISIBILITIES as readonly string[]).includes(value);
}

export function sourceVisibilityNeedsChapter(value: SourceVisibility): boolean {
  return value === "chapter-member" || value === "chapter-organizer";
}

export function canAccessSource(
  source: SourceSubject,
  user: UserSubject,
  chapters: readonly Membership[],
): boolean {
  if (user.isAdmin) return true;
  if (source.addedBy === user.id) return true;
  switch (source.visibility) {
    case "private":
      return false;
    case "member":
      return chapters.length > 0;
    case "organizer":
      return chapters.some((chapter) => chapter.role === "organizer");
    case "chapter-member":
      return chapters.some((chapter) => String(chapter.chapterId) === source.chapterId);
    case "chapter-organizer":
      return chapters.some(
        (chapter) => String(chapter.chapterId) === source.chapterId && chapter.role === "organizer",
      );
    default:
      return false;
  }
}

export function canClassesAccessSource(
  source: { visibility: string; chapterId: string | null },
  classes: readonly PermissionClass[],
): boolean {
  switch (source.visibility) {
    case "private":
      return false;
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

export function canClassesSeePage(page: PageSubject, classes: readonly PermissionClass[]): boolean {
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

export function parseLevelAudienceKey(level: string): SourceAudienceKey | null {
  if (level === "private" || level === "member" || level === "organizer") {
    return sourceAudienceKey(level, null);
  }
  const match = /^(chapter-member|chapter-organizer):(.+)$/.exec(level.trim());
  if (!match) return null;
  return sourceAudienceKey(match[1], match[2]);
}

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
      return page.visibility === "restricted" && !hasEmailGrant && chapterGrants.length > 0;
    case "organizer":
      return page.visibility === "organizer";
    case "chapter-member":
      return (
        page.visibility === "restricted" &&
        !hasEmailGrant &&
        chapterGrants.length > 0 &&
        chapterGrants.every((entry) => entry.subjectKey === key.chapterId)
      );
    case "chapter-organizer":
      return false;
    default:
      return false;
  }
}

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

export function pageAudienceIncludesChannel(
  page: PageSubject,
  channel: SourceAudienceKey,
): boolean {
  if (page.visibility === "public" || page.visibility === "unlisted") return true;
  switch (page.visibility) {
    case "member":
      return channel.kind !== "private";
    case "organizer":
      return channel.kind === "organizer" || channel.kind === "chapter-organizer";
    case "restricted": {
      const grants = page.access.filter((entry) => entry.subjectType === "chapter");
      const hasEmailGrant = page.access.some((entry) => entry.subjectType === "email");
      if (hasEmailGrant || grants.length !== 1) return false;
      const grant = grants[0];
      return (
        grant !== undefined &&
        (channel.kind === "chapter-member" || channel.kind === "chapter-organizer") &&
        grant.subjectKey === channel.chapterId
      );
    }
    default:
      return false;
  }
}

function channelSourceKey(visibility: string, chapterId: string | null): SourceAudienceKey | null {
  return sourceAudienceKey(visibility, chapterId);
}

export function canClassesAccessSourceInChannel(
  source: { visibility: string; chapterId: string | null },
  classes: readonly PermissionClass[],
  channel: SourceAudienceKey,
): boolean {
  const sourceKey = channelSourceKey(source.visibility, source.chapterId);
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

export function canMutatePage(classes: readonly PermissionClass[], page: PageSubject): boolean {
  if (classes.length === 0) return false;
  if (classes.some((permissionClass) => permissionClass.role === "organizer")) return true;
  if (
    ![
      "public",
      "unlisted",
      "private",
      "member",
      "organizer",
      "chapter-member",
      "chapter-organizer",
      "restricted",
    ].includes(page.visibility)
  ) {
    return false;
  }
  if (page.visibility === "public" || page.visibility === "unlisted") return true;
  if (page.chapterId === null) return false;
  return classes.some(
    (permissionClass) => String(permissionClass.chapterId) === String(page.chapterId),
  );
}
