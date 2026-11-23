import { sourceAudienceKey } from "@gdgjp/gdg-lib/acl";

export type AudienceSource = {
  visibility: string;
  chapterId: string | null;
  addedBy: string;
};

export const NO_AUDIENCE = "none";

export function sourceAudience(source: AudienceSource): string {
  const key = sourceAudienceKey(source.visibility, source.chapterId);
  if (!key) return NO_AUDIENCE;
  switch (key.kind) {
    case "private":
      return `private:${source.addedBy}`;
    case "member":
    case "organizer":
      return key.kind;
    case "chapter-member":
    case "chapter-organizer":
      return `${key.kind}:${key.chapterId}`;
    default:
      return NO_AUDIENCE;
  }
}

export function readableAudienceKeys(
  user: { id: string; isAdmin?: boolean | null } | null,
  chapters: readonly { chapterId: string | number; role: string }[],
): string[] | "all" {
  if (user?.isAdmin) return "all";
  const keys = new Set<string>();
  if (!user) return [];
  keys.add(`private:${user.id}`);
  if (chapters.length > 0) keys.add("member");
  if (chapters.some((chapter) => chapter.role === "organizer")) keys.add("organizer");
  for (const chapter of chapters) {
    const id = String(chapter.chapterId);
    keys.add(`chapter-member:${id}`);
    if (chapter.role === "organizer") keys.add(`chapter-organizer:${id}`);
  }
  return [...keys];
}
