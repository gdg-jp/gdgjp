import { sourceAudience } from "./audience";

export function rawObjectKey(spaceId: string, sourceId: string, path: string): string {
  return `spaces/${spaceId}/raw/${sourceId}/${path}`;
}

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
