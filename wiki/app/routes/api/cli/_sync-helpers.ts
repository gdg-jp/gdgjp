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
    /** When true, UPDATE also writes visibility / general_role / chapter_id. */
    updateSharing?: boolean;
  };
};

export type SyncAccessEntry = {
  subjectType: "email" | "chapter";
  subjectKey: string;
  subjectLabel: string;
  role: "viewer" | "commenter" | "editor";
};

export type StoredSyncSharing = {
  visibility: string;
  generalRole: string;
  chapterId: string | null;
  access: readonly SyncAccessEntry[];
};

export type RequestedSyncSharing = {
  visibility: string;
  generalRole: string;
  chapterId: string | null;
  access: readonly SyncAccessEntry[];
};

/**
 * Existing-page sync must not collapse Wiki-app sharing back to the AGENTS.md
 * create defaults (`restricted` / `viewer` / no grants). Agents often rewrite
 * front matter from the template while updating body content. Non-default
 * visibility changes are treated as intentional and kept.
 */
export function resolveExistingPageSharing(
  stored: StoredSyncSharing,
  requested: RequestedSyncSharing,
): { sharing: RequestedSyncSharing; sharingChanged: boolean; preserved: boolean } {
  const looksLikeCreateDefault =
    requested.visibility === "restricted" &&
    requested.generalRole === "viewer" &&
    requested.chapterId == null &&
    requested.access.length === 0;
  const wouldCollapseWikiSharing =
    looksLikeCreateDefault &&
    (stored.visibility !== "restricted" ||
      stored.generalRole !== "viewer" ||
      stored.chapterId != null ||
      stored.access.length > 0);

  const sharing = wouldCollapseWikiSharing
    ? {
        visibility: stored.visibility,
        generalRole: stored.generalRole,
        chapterId: stored.chapterId,
        access: stored.access.map((entry) => ({ ...entry })),
      }
    : {
        visibility: requested.visibility,
        generalRole: requested.generalRole,
        chapterId: requested.chapterId,
        access: requested.access.map((entry) => ({ ...entry })),
      };

  const storedAccess = stored.access
    .map(
      (entry) =>
        `${entry.subjectType}\u0000${entry.subjectKey}\u0000${entry.subjectLabel}\u0000${entry.role}`,
    )
    .sort();
  const nextAccess = sharing.access
    .map(
      (entry) =>
        `${entry.subjectType}\u0000${entry.subjectKey}\u0000${entry.subjectLabel}\u0000${entry.role}`,
    )
    .sort();
  const sharingChanged =
    stored.visibility !== sharing.visibility ||
    stored.generalRole !== sharing.generalRole ||
    stored.chapterId !== sharing.chapterId ||
    storedAccess.join("\n") !== nextAccess.join("\n");

  return { sharing, sharingChanged, preserved: wouldCollapseWikiSharing };
}

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
  aclSourceIdsJson?: string,
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
    "last_edited_by=?",
    "updated_at=unixepoch()",
  );
  binds.push(
    page.slug,
    page.parentId,
    page.sortOrder,
    page.meta.pageType,
    page.meta.pageMetadata === null ? null : JSON.stringify(page.meta.pageMetadata),
    lastEditedBy,
  );

  if (page.meta.updateSharing) {
    sets.push("visibility=?", "general_role=?", "chapter_id=?");
    binds.push(page.meta.visibility, page.meta.generalRole, page.meta.chapterId);
  }

  if (aclSourceIdsJson !== undefined) {
    sets.push("acl_source_ids=?");
    binds.push(aclSourceIdsJson);
  }

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

/** Zod refine helper: source requires title and (url OR sourceId OR existing id).
 * Existing `id` covers snapshot round-trips where the server emitted a
 * page_sources row with an empty url and null sourceId. */
export function sourceHasReference(source: {
  title: string;
  url?: string;
  sourceId?: string | null;
  id?: string;
}): boolean {
  return Boolean(source.title && (source.url || source.sourceId || source.id));
}
