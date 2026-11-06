// Client-safe vocabulary of the knowledge index (Stage 03).

export type KnowledgeLayer = "raw" | "page" | "acl";
export const KNOWLEDGE_LAYERS: readonly KnowledgeLayer[] = ["raw", "page", "acl"];
/** UI search never shows raw material by default; agents opt in. */
export const DEFAULT_UI_LAYERS: readonly KnowledgeLayer[] = ["page", "acl"];

/** `audience` of the redacted page body — readable by every viewer of the space. */
export const PAGE_AUDIENCE = "page";

/** The five custom metadata fields every instance declares (AI Search allows five). */
export const KNOWLEDGE_METADATA_FIELDS = [
  "layer",
  "audience",
  "source_id",
  "page_type",
  "lang",
] as const;

/** Item keys are ids, not slugs: stable across renames and within the 128-char limit. */
export function pageItemKey(pageId: string, lang: "ja" | "en"): string {
  return `pages/${pageId}.${lang}.md`;
}
export function aclItemKey(audience: string, pageId: string, lang: "ja" | "en"): string {
  return `acl/${audience}/${pageId}.${lang}.md`;
}
export function rawItemKey(documentId: string): string {
  return `raw/${documentId}.md`;
}

export type ParsedItemKey =
  | { layer: "page"; pageId: string; lang: string }
  | { layer: "acl"; audience: string; pageId: string; lang: string }
  | { layer: "raw"; documentId: string };

export function parseItemKey(key: string): ParsedItemKey | null {
  let match = /^pages\/([^/]+)\.(ja|en)\.md$/.exec(key);
  if (match?.[1] && match[2]) return { layer: "page", pageId: match[1], lang: match[2] };
  match = /^acl\/(.+)\/([^/]+)\.(ja|en)\.md$/.exec(key);
  if (match?.[1] && match[2] && match[3]) {
    return { layer: "acl", audience: match[1], pageId: match[2], lang: match[3] };
  }
  match = /^raw\/([^/]+)\.md$/.exec(key);
  if (match?.[1]) return { layer: "raw", documentId: match[1] };
  return null;
}
