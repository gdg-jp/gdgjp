/**
 * Server-side policy evaluation for page-body ACL spans.
 *
 * Span evaluation MUST call canAccessSource directly so raw visibility and
 * derived-span visibility stay in lockstep when source permissions change.
 * Do not invent a second evaluator or a total confidentiality ordering.
 */

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
} from "~/lib/acl-spans";
import { mapInChunks } from "~/lib/d1-chunk.server";
import { canAccessSource } from "~/lib/sources.server";

// Structural enough for both getDb() and workers' drizzle(env.DB, { schema }).
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

/**
 * Build a synchronous allow predicate for redactAclSpans.
 * Loads every referenced source in one inArray query.
 */
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

    // Logical AND across sources; missing/deleted src → Admin only (fail closed).
    // Archived sources keep their visibility — archive is a lifecycle state, not ACL revocation.
    return span.srcIds.every((id) => {
      const source = sourceById.get(id);
      if (!source) {
        return user.isAdmin;
      }
      return canAccessSource(source, user, chapters);
    });
  };
}

/** True only when every ACL span across the given markdowns is allowed. */
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

/** Redact denied spans and always strip tags. Scrubs residual malformed markers too. */
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
  /** Cited source IDs from front matter sources[]. */
  citedSourceIds: readonly string[];
  /** Existing opposite-locale body, used when only one locale is in the upsert. */
  storedContentJa?: string | null;
  storedContentEn?: string | null;
  contentJa?: string | null;
  contentEn?: string | null;
};

/**
 * Validate ACL tags on a sync upsert. Does not check redacted_page_not_editable
 * (that needs the pusher's clearance over the stored page).
 */
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
        })
        .from(schema.sources)
        .where(inArray(schema.sources.id, chunk))
        .all(),
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of uniqueSrcIds) {
      const source = byId.get(id);
      // Archived sources remain citeable; only truly missing ids are unknown.
      if (!source) {
        return { ok: false, error: "acl_unknown_source", sourceId: id };
      }
      if (!canAccessSource(source, user, chapters)) {
        return { ok: false, error: "acl_unknown_source", sourceId: id };
      }
    }
  }

  // Invariant: every cited source must either be audience-covered by the page
  // or appear in at least one <acl src> span in either locale body.
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
        // Unknown citation is a separate concern; require a span to be safe.
        return { ok: false, error: "acl_required", sourceId: id };
      }
      // Archived sources keep visibility — evaluate the invariant the same way.
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

/**
 * Run-level ingest gate: every read source narrower than `member` must either
 * appear in an `<acl src>` on at least one submitted page, or be audience-covered
 * by every submitted page. Does not require every page to tag S.
 */
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
    // Archive does not change visibility; member-wide reads still need no tag.
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
