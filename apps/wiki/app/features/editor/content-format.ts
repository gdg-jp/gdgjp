import { type TipTapDoc, tiptapToMarkdown } from "~/features/editor/tiptap-convert";

export function canonicalMarkdown(content: string): string {
  return legacyTiptapToMarkdown(content) ?? content;
}

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

export function ingestionImageKeysFromMarkdown(markdown: string): string[] {
  const keys = new Set<string>();
  const imageDestination =
    /!\[[^\]]*\]\(\s*<?\/api\/images\/(ingestion\/[^\s)>]+)>?(?:\s+[^)]*)?\)/g;
  for (const match of markdown.matchAll(imageDestination)) keys.add(match[1]);
  return [...keys];
}
