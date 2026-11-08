export type SourceKind =
  | "google-doc"
  | "google-sheet"
  | "google-slides"
  | "google-drive-folder"
  | "google-chat-space"
  | "discord-channel"
  | "discord-guild"
  | "website"
  | "upload"
  | "text"
  | "conversation";

export type SourceRefreshPolicy = "manual" | "hourly" | "daily" | "weekly";

export {
  SOURCE_VISIBILITIES,
  isSourceVisibility,
  sourceVisibilityNeedsChapter,
} from "@gdgjp/gdg-lib/acl";
export type { SourceVisibility } from "@gdgjp/gdg-lib/acl";
