export type SourceKind =
  | "google-doc"
  | "google-sheet"
  | "google-slides"
  | "google-chat-space"
  | "discord-channel"
  | "website"
  | "upload"
  | "text"
  | "conversation";

export type SourceRefreshPolicy = "manual" | "daily" | "weekly";

export {
  SOURCE_VISIBILITIES,
  isSourceVisibility,
  sourceVisibilityNeedsChapter,
} from "@gdgjp/gdg-lib/acl";
export type { SourceVisibility } from "@gdgjp/gdg-lib/acl";
