import { canonicalMarkdown } from "~/features/editor/content-format";

type WikiHumanFrontMatter = {
  gdg_wiki: 1;
  id: string;
  slug: string;
  language: "ja" | "en";
  title: string;
  summary: string;
  translation_status: string;
  page_type?: string | null;
  page_metadata?: unknown;
  parent_slug?: string | null;
  sort_order?: number;
  visibility?: string;
  general_role?: string;
  chapter_id?: string | null;
  tags?: string[];
  access?: unknown;
  sources?: unknown;
  attachments?: unknown;
  acl_redacted?: boolean;
};

function yamlQuote(value: string): string {
  if (
    value === "" ||
    /[:#\n]|^\s/.test(value) ||
    value === "true" ||
    value === "false" ||
    value === "null"
  ) {
    return JSON.stringify(value);
  }
  return value;
}

function yamlLine(key: string, value: unknown, indent = 0): string[] {
  const pad = "  ".repeat(indent);
  if (value === undefined) return [];
  if (value === null) return [`${pad}${key}: null`];
  if (typeof value === "number" || typeof value === "boolean") {
    return [`${pad}${key}: ${String(value)}`];
  }
  if (typeof value === "string") {
    return [`${pad}${key}: ${yamlQuote(value)}`];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}${key}: []`];
    if (value.every((item) => typeof item === "string")) {
      return [`${pad}${key}:`, ...value.map((item) => `${pad}  - ${yamlQuote(item)}`)];
    }
    return [`${pad}${key}: ${JSON.stringify(value)}`];
  }
  return [`${pad}${key}: ${JSON.stringify(value)}`];
}

function renderFrontMatter(fm: WikiHumanFrontMatter): string {
  const lines = [
    ...yamlLine("gdg_wiki", fm.gdg_wiki),
    ...yamlLine("id", fm.id),
    ...yamlLine("slug", fm.slug),
    ...yamlLine("language", fm.language),
    ...yamlLine("title", fm.title),
    ...yamlLine("summary", fm.summary),
    ...yamlLine("translation_status", fm.translation_status),
    ...yamlLine("page_type", fm.page_type),
    ...yamlLine("page_metadata", fm.page_metadata),
    ...yamlLine("parent_slug", fm.parent_slug),
    ...yamlLine("sort_order", fm.sort_order),
    ...yamlLine("visibility", fm.visibility),
    ...yamlLine("general_role", fm.general_role),
    ...yamlLine("chapter_id", fm.chapter_id),
    ...yamlLine("tags", fm.tags),
    ...yamlLine("access", fm.access),
    ...yamlLine("sources", fm.sources),
    ...yamlLine("attachments", fm.attachments),
    ...yamlLine("acl_redacted", fm.acl_redacted),
  ];
  return `---\n${lines.join("\n")}\n---\n`;
}

export type WikiHumanPageInput = {
  id: string;
  slug: string;
  sortOrder: number;
  pageType: string | null;
  pageMetadata: string | null;
  visibility: string;
  generalRole: string;
  chapterId: string | null;
  titleJa: string;
  titleEn: string;
  summaryJa: string;
  summaryEn: string;
  contentJa: string;
  contentEn: string;
  translationStatusJa: string;
  translationStatusEn: string;
  parentSlug: string | null;
  tags: string[];
  access: unknown;
  sources: unknown;
  attachments: unknown;
  aclRedacted?: boolean;
};

export type WikiCloneLanguage = "ja" | "en";

export function parseWikiCloneLanguage(value: string | null): WikiCloneLanguage | null {
  if (value === null || value === "ja") return "ja";
  if (value === "en") return "en";
  return null;
}

export function renderWikiHumanDocument(
  page: WikiHumanPageInput,
  lang: WikiCloneLanguage,
): { title: string; markdown: string } {
  const locale =
    lang === "en"
      ? {
          title: page.titleEn,
          summary: page.summaryEn,
          content: canonicalMarkdown(page.contentEn),
          translationStatus: page.translationStatusEn,
        }
      : {
          title: page.titleJa,
          summary: page.summaryJa,
          content: canonicalMarkdown(page.contentJa),
          translationStatus: page.translationStatusJa,
        };

  let effectiveLang = lang;
  if (locale.title === "" && locale.content === "" && lang === "ja" && page.titleEn !== "") {
    effectiveLang = "en";
    locale.title = page.titleEn;
    locale.summary = page.summaryEn;
    locale.content = canonicalMarkdown(page.contentEn);
    locale.translationStatus = page.translationStatusEn;
  }

  const fm: WikiHumanFrontMatter = {
    gdg_wiki: 1,
    id: page.id,
    slug: page.slug,
    language: effectiveLang,
    title: locale.title,
    summary: locale.summary,
    translation_status: locale.translationStatus,
    page_type: page.pageType,
    page_metadata: page.pageMetadata ? JSON.parse(page.pageMetadata) : null,
    parent_slug: page.parentSlug,
    sort_order: page.sortOrder,
    visibility: page.visibility,
    general_role: page.generalRole,
    chapter_id: page.chapterId,
    tags: page.tags,
    access: page.access,
    sources: page.sources,
    attachments: page.attachments,
    ...(page.aclRedacted ? { acl_redacted: true } : {}),
  };

  return {
    title: locale.title,
    markdown: renderFrontMatter(fm) + locale.content,
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const WIKI_HUMAN_PREFIX = "wiki-human:";

export function wikiHumanDocumentId(pageId: string): string {
  return `${WIKI_HUMAN_PREFIX}${pageId}`;
}

export function parseWikiHumanDocumentId(documentId: string): string | null {
  return documentId.startsWith(WIKI_HUMAN_PREFIX)
    ? documentId.slice(WIKI_HUMAN_PREFIX.length)
    : null;
}
