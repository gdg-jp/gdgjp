import type { OgpData } from "./ogp";

/** Response shared by the link form's fetchers and its HTTP adapter. */
export type ApiLinksActionData = { error: string } | { ogp: OgpData | null } | null;
