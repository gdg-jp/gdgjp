export type LocalePayload = {
  title: string;
  summary: string;
  translationStatus: "human" | "ai" | "missing";
  content: string;
};

export type PageLocaleRow = {
  titleJa: string;
  summaryJa: string;
  contentJa: string;
  translationStatusJa: string;
  titleEn: string;
  summaryEn: string;
  contentEn: string;
  translationStatusEn: string;
};

export type PartialLocalePagePayload = {
  slug: string;
  parentId: string | null;
  sortOrder: number;
  ja?: LocalePayload;
  en?: LocalePayload;
  meta: {
    pageType: string | null;
    pageMetadata: unknown;
    visibility: string;
    generalRole: string;
    chapterId: string | null;
  };
};

/** True when JA title, summary, or canonical content differs from the stored row. */
export function jaContentChanged(
  current: PageLocaleRow,
  pageJa: LocalePayload | undefined,
  contentJaCanonical: string | undefined,
): boolean {
  if (!pageJa || contentJaCanonical === undefined) return false;
  return (
    current.titleJa !== pageJa.title ||
    current.summaryJa !== pageJa.summary ||
    current.contentJa !== contentJaCanonical
  );
}

/** Reject sync upserts against human-authored pages. */
export function humanOriginSyncError(origin: string | undefined): "human_origin" | null {
  return origin === "human" ? "human_origin" : null;
}

/** Reject agent pages parented under human-authored pages. */
export function humanParentSyncError(parentOrigin: string | undefined): "human_parent" | null {
  return parentOrigin === "human" ? "human_parent" : null;
}

export function buildPartialLocaleUpdate(
  page: PartialLocalePagePayload,
  contentJa: string | undefined,
  contentEn: string | undefined,
  lastEditedBy: string,
  id: string,
  expectedRevision: number | undefined,
): { sql: string; binds: unknown[] } {
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (page.ja) {
    sets.push("title_ja=?", "summary_ja=?", "content_ja=?", "translation_status_ja=?");
    binds.push(page.ja.title, page.ja.summary, contentJa, page.ja.translationStatus);
  }
  if (page.en) {
    sets.push("title_en=?", "summary_en=?", "content_en=?", "translation_status_en=?");
    binds.push(page.en.title, page.en.summary, contentEn, page.en.translationStatus);
  }

  sets.push(
    "slug=?",
    "parent_id=?",
    "sort_order=?",
    "page_type=?",
    "page_metadata=?",
    "visibility=?",
    "general_role=?",
    "chapter_id=?",
    "last_edited_by=?",
    "updated_at=unixepoch()",
  );
  binds.push(
    page.slug,
    page.parentId,
    page.sortOrder,
    page.meta.pageType,
    page.meta.pageMetadata === null ? null : JSON.stringify(page.meta.pageMetadata),
    page.meta.visibility,
    page.meta.generalRole,
    page.meta.chapterId,
    lastEditedBy,
  );

  const where = expectedRevision ? " WHERE id=? AND sync_revision=?" : " WHERE id=?";
  binds.push(id);
  if (expectedRevision) binds.push(expectedRevision);

  return {
    sql: `UPDATE pages SET ${sets.join(",")}${where}`,
    binds,
  };
}

export function buildNewPageLocaleValues(page: PartialLocalePagePayload): {
  titleJa: string;
  titleEn: string;
  summaryJa: string;
  summaryEn: string;
  translationStatusJa: "human" | "ai" | "missing";
  translationStatusEn: "human" | "ai" | "missing";
} {
  return {
    titleJa: page.ja?.title ?? "",
    titleEn: page.en?.title ?? "",
    summaryJa: page.ja?.summary ?? "",
    summaryEn: page.en?.summary ?? "",
    translationStatusJa: page.ja?.translationStatus ?? "missing",
    translationStatusEn: page.en?.translationStatus ?? "missing",
  };
}

/** Zod refine helper: source requires title and (url OR sourceId). */
export function sourceHasReference(source: {
  title: string;
  url?: string;
  sourceId?: string | null;
}): boolean {
  return Boolean(source.title && (source.url || source.sourceId));
}
