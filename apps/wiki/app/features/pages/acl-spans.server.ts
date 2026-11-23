import type { AuthUser } from "@gdgjp/gdg-lib";
import { audienceContains, parseLevelAudienceKey, sourceAudienceKey } from "@gdgjp/gdg-lib/acl";
import type { PageAudienceSubject, SourceAudienceKey } from "@gdgjp/gdg-lib/acl";
import { inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import {
  type AclSpan,
  aclSpanSourceIds,
  metadataContainsAclTag,
  parseAclSpans,
  redactAclSpans,
  scrubResidualAclMarkup,
  validateAclSpans,
} from "~/features/pages/acl-spans";
import { mapInChunks } from "~/features/pages/d1-chunk.server";
import { canAccessSource } from "~/features/sources/sources.server";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle schema generics are invariant across call sites
type Db = DrizzleD1Database<any>;
type Membership = { chapterId: string | number; role: string };

export { audienceContains, parseLevelAudienceKey, sourceAudienceKey };
export type { PageAudienceSubject, SourceAudienceKey };

function syntheticSourceFromLevel(
  level: string,
): { addedBy: string; chapterId: string | null; visibility: string } | null {
  const key = parseLevelAudienceKey(level);
  if (!key) return null;
  switch (key.kind) {
    case "private":
    case "member":
    case "organizer":
      return { addedBy: "", chapterId: null, visibility: key.kind };
    case "chapter-member":
      return { addedBy: "", chapterId: key.chapterId, visibility: "chapter-member" };
    case "chapter-organizer":
      return { addedBy: "", chapterId: key.chapterId, visibility: "chapter-organizer" };
  }
}

export async function buildAclSpanPolicy(
  db: Db,
  spanSourceIds: readonly string[],
  user: AuthUser | null,
  chapters: readonly Membership[],
): Promise<(span: AclSpan) => boolean> {
  const uniqueIds = [...new Set(spanSourceIds.filter((id) => id.length > 0))];
  const rows = await mapInChunks(uniqueIds, (chunk) =>
    db
      .select({
        id: schema.sources.id,
        addedBy: schema.sources.addedBy,
        chapterId: schema.sources.chapterId,
        visibility: schema.sources.visibility,
        status: schema.sources.status,
      })
      .from(schema.sources)
      .where(inArray(schema.sources.id, chunk))
      .all(),
  );

  const sourceById = new Map(rows.map((row) => [row.id, row]));

  return (span: AclSpan): boolean => {
    if (!user) return false;

    if (span.level !== null) {
      const synthetic = syntheticSourceFromLevel(span.level);
      if (!synthetic) return false;
      return canAccessSource(synthetic, user, chapters);
    }

    if (span.srcIds.length === 0) return false;

    return span.srcIds.every((id) => {
      const source = sourceById.get(id);
      if (!source) {
        return user.isAdmin;
      }
      return canAccessSource(source, user, chapters);
    });
  };
}

export async function pageAclClearance(
  db: Db,
  markdowns: readonly (string | null | undefined)[],
  user: AuthUser | null,
  chapters: readonly Membership[],
): Promise<boolean> {
  const ids: string[] = [];
  const spans: AclSpan[] = [];
  for (const markdown of markdowns) {
    if (!markdown) continue;
    for (const span of parseAclSpans(markdown)) {
      spans.push(span);
      ids.push(...span.srcIds);
    }
  }
  if (spans.length === 0) return true;
  const allow = await buildAclSpanPolicy(db, ids, user, chapters);
  return spans.every((span) => allow(span));
}

export async function redactPageMarkdown(
  db: Db,
  markdown: string,
  user: AuthUser | null,
  chapters: readonly Membership[],
): Promise<string> {
  const spans = parseAclSpans(markdown);
  if (spans.length === 0) return scrubResidualAclMarkup(markdown);
  const allow = await buildAclSpanPolicy(
    db,
    spans.flatMap((span) => span.srcIds),
    user,
    chapters,
  );
  return redactAclSpans(markdown, allow).markdown;
}

export type AclSyncValidationPage = {
  title?: string;
  summary?: string;
  content?: string;
  tags?: readonly string[];
};

export type AclSyncContext = {
  pageVisibility: string;
  pageAccess: readonly { subjectType: string; subjectKey: string }[];
  citedSourceIds: readonly string[];
  spaceId: string;
  storedContentJa?: string | null;
  storedContentEn?: string | null;
  contentJa?: string | null;
  contentEn?: string | null;
};

export async function validatePageAclForSync(
  db: Db,
  locales: { ja?: AclSyncValidationPage; en?: AclSyncValidationPage },
  ctx: AclSyncContext,
  user: AuthUser,
  chapters: readonly Membership[],
): Promise<{ ok: true } | { ok: false; error: string; sourceId?: string }> {
  for (const locale of [locales.ja, locales.en]) {
    if (!locale) continue;
    if (
      metadataContainsAclTag(locale.title ?? "") ||
      metadataContainsAclTag(locale.summary ?? "") ||
      (locale.tags ?? []).some((tag) => metadataContainsAclTag(tag))
    ) {
      return { ok: false, error: "acl_in_metadata" };
    }
    if (locale.content) {
      const validated = validateAclSpans(locale.content);
      if (!validated.ok) return { ok: false, error: validated.error };
    }
  }

  const contentJa = ctx.contentJa ?? ctx.storedContentJa ?? "";
  const contentEn = ctx.contentEn ?? ctx.storedContentEn ?? "";
  const allSrcIds = [...aclSpanSourceIds(contentJa), ...aclSpanSourceIds(contentEn)];
  const uniqueSrcIds = [...new Set(allSrcIds)];

  if (uniqueSrcIds.length > 0) {
    const rows = await mapInChunks(uniqueSrcIds, (chunk) =>
      db
        .select({
          id: schema.sources.id,
          addedBy: schema.sources.addedBy,
          chapterId: schema.sources.chapterId,
          visibility: schema.sources.visibility,
          status: schema.sources.status,
          spaceId: schema.sources.spaceId,
        })
        .from(schema.sources)
        .where(inArray(schema.sources.id, chunk))
        .all(),
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of uniqueSrcIds) {
      const source = byId.get(id);
      if (!source || source.spaceId !== ctx.spaceId) {
        return { ok: false, error: "acl_unknown_source", sourceId: id };
      }
      if (!canAccessSource(source, user, chapters)) {
        return { ok: false, error: "acl_unknown_source", sourceId: id };
      }
    }
  }

  const spanIdSet = new Set(uniqueSrcIds);
  if (ctx.citedSourceIds.length > 0) {
    const citedUnique = [...new Set(ctx.citedSourceIds.filter(Boolean))];
    const citedRows = await mapInChunks(citedUnique, (chunk) =>
      db
        .select({
          id: schema.sources.id,
          visibility: schema.sources.visibility,
          chapterId: schema.sources.chapterId,
          status: schema.sources.status,
        })
        .from(schema.sources)
        .where(inArray(schema.sources.id, chunk))
        .all(),
    );
    const citedById = new Map(citedRows.map((row) => [row.id, row]));
    const pageAudience: PageAudienceSubject = {
      visibility: ctx.pageVisibility,
      access: ctx.pageAccess,
    };

    for (const id of citedUnique) {
      if (spanIdSet.has(id)) continue;
      const source = citedById.get(id);
      if (!source) {
        return { ok: false, error: "acl_required", sourceId: id };
      }
      const key = sourceAudienceKey(source.visibility, source.chapterId);
      if (!key || !audienceContains(key, pageAudience)) {
        return { ok: false, error: "acl_required", sourceId: id };
      }
    }
  }

  return { ok: true };
}

export type ValidateReadSourcesPage = {
  slug: string;
  visibility: string;
  access: readonly { subjectType: string; subjectKey: string }[];
  content: string;
};

export async function validateReadSourcesTagged(
  db: Db,
  pages: readonly ValidateReadSourcesPage[],
  readSourceIds: readonly string[],
  _user: AuthUser,
  _chapters: readonly Membership[],
): Promise<{ ok: true } | { ok: false; error: string; sourceId?: string }> {
  const uniqueIds = [...new Set(readSourceIds.filter((id) => id.length > 0))];
  if (uniqueIds.length === 0) return { ok: true };

  const rows = await mapInChunks(uniqueIds, (chunk) =>
    db
      .select({
        id: schema.sources.id,
        visibility: schema.sources.visibility,
        chapterId: schema.sources.chapterId,
        status: schema.sources.status,
      })
      .from(schema.sources)
      .where(inArray(schema.sources.id, chunk))
      .all(),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));

  const taggedIds = new Set<string>();
  for (const page of pages) {
    for (const id of aclSpanSourceIds(page.content)) taggedIds.add(id);
  }

  for (const id of uniqueIds) {
    const source = byId.get(id);
    if (source && source.visibility === "member") {
      continue;
    }
    if (taggedIds.has(id)) continue;

    if (source && pages.length > 0) {
      const key = sourceAudienceKey(source.visibility, source.chapterId);
      if (
        key &&
        pages.every((page) =>
          audienceContains(key, {
            visibility: page.visibility,
            access: page.access,
          }),
        )
      ) {
        continue;
      }
    }

    return { ok: false, error: "acl_untagged_read_source", sourceId: id };
  }

  return { ok: true };
}
