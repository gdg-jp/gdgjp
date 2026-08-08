export type SourceKind = "google-doc" | "google-chat-space" | "website" | "upload" | "text";

export type SourceRefreshPolicy = "manual" | "daily" | "weekly";

/**
 * Explicit opt-in for a source every signed-in member may read.
 *
 * Lives outside `sources.server.ts` because the `/sources` form renders it as an option
 * value; importing the server module from component code would break the server-only
 * boundary Vite enforces.
 */
export const ALL_CHAPTERS = "__all__";
