import type { OgpData } from "./ogp";

export type ApiLinksActionData = { error: string } | { ogp: OgpData | null } | null;
