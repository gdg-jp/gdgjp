import { sourceAudience } from "./audience";

/**
 * v2 layout: one object per document under its space, overwritten when the content changes.
 * AI Search indexes `spaces/<spaceId>/**`, so a stable key means one live copy per document.
 */
export function rawObjectKey(spaceId: string, sourceId: string, path: string): string {
  return `spaces/${spaceId}/raw/${sourceId}/${path}`;
}

/** R2 custom metadata AI Search filters on (5 fields; see Stage 03). */
export function rawObjectMetadata(
  source: { id: string; visibility: string; chapterId: string | null; addedBy: string },
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    layer: "raw",
    audience: sourceAudience(source),
    source_id: source.id,
    page_type: "",
    lang: "",
    ...extra,
  };
}
