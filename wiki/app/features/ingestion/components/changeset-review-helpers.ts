import { applyPatchesToMarkdown, tiptapToMarkdown } from "~/features/editor/tiptap-convert";
import type {
  AiDraftJson,
  ChangesetOperation,
  PageDraft,
  SectionPatchResponse,
} from "../../../../shared/ingestion/domain";

export type ResultDraft = Extract<AiDraftJson, { planRationale: string }>;

export const PAGE_TYPE_VALUES = [
  "event-report",
  "speaker-profile",
  "project-log",
  "how-to-guide",
  "onboarding-guide",
  "survey-report",
] as const;

export const CANONICAL_TAG_SLUGS = [
  "event-operations",
  "speaker-management",
  "sponsor-relations",
  "project",
  "onboarding",
  "community-ops",
  "technical",
  "template",
] as const;

export interface PageIndexEntry {
  id: string;
  titleJa: string;
  titleEn: string;
  slug: string;
  parentId: string | null;
}

export interface OperationState {
  title: string;
  tiptapJson: string;
  summaryJa: string;
  pageType: string;
  tags: string[];
  pageMetadata: Record<string, string>;
  suggestedSlug?: string;
  parentId: string | null;
}

export function initOpState(op: ChangesetOperation): OperationState {
  const draft = op.draft;
  return {
    title: draft?.title.ja ?? op.pageTitle ?? "",
    tiptapJson: "",
    summaryJa: draft?.summary.ja ?? "",
    pageType: draft?.suggestedPageType ?? "how-to-guide",
    tags: draft?.suggestedTags ?? [],
    pageMetadata: draft?.metadata ?? {},
    suggestedSlug: draft?.suggestedSlug,
    parentId: draft?.suggestedParentId ?? null,
  };
}

export function buildMarkdownFromDraft(draft: PageDraft): string {
  return draft.sections.map((section) => `## ${section.heading}\n\n${section.body}`).join("\n\n");
}

export function buildMarkdownFromPatch(
  patch: SectionPatchResponse,
  existingTipTapJson?: string,
): string {
  const existingMarkdown = existingTipTapJson ? tiptapToMarkdown(existingTipTapJson) : "";
  return applyPatchesToMarkdown(existingMarkdown, patch.sectionPatches);
}

export function buildImageUrlMap(imageKeys: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const key of imageKeys) {
    const name = key.split("/").at(-1) ?? key;
    map[name] = `/api/images/${key}`;
  }
  return map;
}

export function resolveImgPlaceholders(
  markdown: string,
  imageUrlMap: Record<string, string>,
): string {
  return markdown.replace(/\(img:([^)]+)\)/g, (_, name) => `(${imageUrlMap[name] ?? "#"})`);
}
