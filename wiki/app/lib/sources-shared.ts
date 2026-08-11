export type SourceKind =
  | "google-doc"
  | "google-sheet"
  | "google-slides"
  | "google-chat-space"
  | "website"
  | "upload"
  | "text";

export type SourceRefreshPolicy = "manual" | "daily" | "weekly";

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
