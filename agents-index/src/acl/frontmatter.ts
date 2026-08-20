import { parseAclSpans } from "@gdgjp/gdg-lib/acl/agent";
import { parse } from "yaml";

import type { MarkdownChunk } from "../indexer/chunk.ts";

export type SourceMetadata = { visibility: string; chapterId: string | null };
export type PageMetadata = SourceMetadata & {
  access: Array<{ subjectType: string; subjectKey: string }>;
};
export type ChunkMetadata = { subject: SourceMetadata | PageMetadata; aclSourceIds: string[] };

type ManifestDocument = {
  path?: unknown;
  sourceId?: unknown;
  visibility?: unknown;
  chapterId?: unknown;
};

function frontMatter(markdown: string): Record<string, unknown> | null {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) return null;
  try {
    const value: unknown = parse(match[1] ?? "");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseAccess(raw: unknown): Array<{ subjectType: string; subjectKey: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    return typeof value.subjectType === "string" && typeof value.subjectKey === "string"
      ? [{ subjectType: value.subjectType, subjectKey: value.subjectKey }]
      : [];
  });
}

export function pageMetadata(markdown: string): PageMetadata | null {
  const fields = frontMatter(markdown);
  const visibility = typeof fields?.visibility === "string" ? fields.visibility : null;
  if (!visibility) return null;
  return {
    visibility,
    chapterId: typeof fields?.chapter_id === "string" ? fields.chapter_id : null,
    access: parseAccess(fields?.access),
  };
}

export function rawMetadata(relativePath: string, state: unknown): SourceMetadata | null {
  if (!state || typeof state !== "object") return null;
  const manifest = (state as Record<string, unknown>).manifest;
  const docs =
    manifest && typeof manifest === "object"
      ? (manifest as Record<string, unknown>).documents
      : null;
  if (!Array.isArray(docs)) return null;
  const found = docs.find((document): document is ManifestDocument =>
    Boolean(
      document &&
        typeof document === "object" &&
        typeof (document as ManifestDocument).path === "string" &&
        (relativePath === (document as ManifestDocument).path ||
          relativePath.startsWith(`${(document as ManifestDocument).path}/`)),
    ),
  );
  if (!found || typeof found.visibility !== "string" || !Object.hasOwn(found, "chapterId"))
    return null;
  return {
    visibility: found.visibility,
    chapterId: typeof found.chapterId === "string" ? found.chapterId : null,
  };
}

export function memoryMetadata(markdown: string): SourceMetadata | null {
  const fields = frontMatter(markdown);
  const visibility = typeof fields?.visibility === "string" ? fields.visibility : null;
  return visibility
    ? { visibility, chapterId: typeof fields?.chapter_id === "string" ? fields.chapter_id : null }
    : null;
}

export function aclSourcesForChunk(markdown: string, chunk: MarkdownChunk): string[] {
  const starts: number[] = [];
  let offset = 0;
  for (const line of markdown.split("\n")) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const ids = new Set<string>();
  for (const span of parseAclSpans(markdown)) {
    const startLine =
      starts.findIndex(
        (value, index) =>
          value <= span.start && (starts[index + 1] ?? Number.POSITIVE_INFINITY) > span.start,
      ) + 1;
    const endLine =
      starts.findIndex(
        (value, index) =>
          value < span.end && (starts[index + 1] ?? Number.POSITIVE_INFINITY) >= span.end,
      ) + 1;
    if (startLine <= chunk.endLine && endLine >= chunk.startLine)
      for (const id of span.srcIds) ids.add(id);
  }
  return [...ids];
}

export function sourceMetadataById(value: unknown): Map<string, SourceMetadata> {
  const entries =
    value && typeof value === "object" ? Object.entries(value as Record<string, unknown>) : [];
  return new Map(
    entries.flatMap(([id, raw]) => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Record<string, unknown>;
      return typeof item.visibility === "string"
        ? [
            [
              id,
              {
                visibility: item.visibility,
                chapterId: typeof item.chapterId === "string" ? item.chapterId : null,
              },
            ] as const,
          ]
        : [];
    }),
  );
}
