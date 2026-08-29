import { type TipTapDoc, tiptapToMarkdown } from "~/features/editor/tiptap-convert";

/**
 * Converts legacy TipTap JSON at an input boundary. Markdown and malformed JSON
 * are returned unchanged so user-authored content is never lost.
 */
export function canonicalMarkdown(content: string): string {
  return legacyTiptapToMarkdown(content) ?? content;
}

/** Returns Markdown only when content is a serialized legacy TipTap document. */
export function legacyTiptapToMarkdown(content: string): string | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return isTipTapDocument(parsed) ? tiptapToMarkdown(parsed) : null;
  } catch {
    return null;
  }
}

function isTipTapDocument(value: unknown): value is TipTapDoc {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return document.type === "doc" && Array.isArray(document.content);
}

/** Extract ingestion R2 image keys from Markdown image destinations. */
export function ingestionImageKeysFromMarkdown(markdown: string): string[] {
  const keys = new Set<string>();
  const imageDestination =
    /!\[[^\]]*\]\(\s*<?\/api\/images\/(ingestion\/[^\s)>]+)>?(?:\s+[^)]*)?\)/g;
  for (const match of markdown.matchAll(imageDestination)) keys.add(match[1]);
  return [...keys];
}
