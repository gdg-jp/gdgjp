import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import type { AgentWorkspaceContext } from "~/lib/agent-workspace.server";
import { canonicalMarkdown } from "~/lib/content-format";
import { getDb } from "~/lib/db.server";
import { getEffectivePagePermissions, getPageAccessList } from "~/lib/page-access.server";
import { sendOrRunTranslation } from "~/lib/queue-processors.server";
import { canAssignChapter } from "~/lib/sources.server";
import { upsertCatalogEntry } from "~/lib/wiki-catalog.server";
import { wikiPagePath } from "~/lib/wiki-page-path";
import { createD1WikiWorkspaceStore } from "../../workers/features/ingestion/persistence/d1/wiki-read-repository";
import { normaliseAbsoluteWorkspacePath } from "../../workers/features/ingestion/tools/workspace/paths";
import {
  type WorkspaceActor,
  resolveWikiWorkspacePage,
} from "../../workers/features/ingestion/tools/workspace/wiki-adapter";

export const NS_ANSWERS = "ns-answers";
export const ANSWERS_SLUG = "answers";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_BODY_KEYS = new Set([
  "slug",
  "title",
  "summary",
  "content",
  "citedPaths",
  "replaceId",
]);

export type NoteRequestBody = {
  slug: string;
  title: string;
  summary: string;
  content: string;
  citedPaths: string[];
  replaceId?: string;
};

export type CreateAnswerNoteResult =
  | {
      ok: true;
      status: 200 | 201;
      body: {
        id: string;
        slug: string;
        path: string;
        pageUrl: string;
        created: boolean;
      };
    }
  | { ok: false; error: string; status: number; path?: string };

/**
 * Authorization for this route is a constant, not a caller-supplied value.
 *
 * Ordinary chapter members lack `canEdit` on the answers namespace page, so they
 * cannot use CLI sync. This bounded route is safe to grant them because it can
 * only create or replace a leaf under the hard-coded parent `ns-answers`, it
 * hard-codes `visibility: restricted` / `page_type: answer` / `origin: agent`,
 * and it never accepts parent, page type, visibility, or chapter from the body.
 * The access floor is derived from cited pages the caller can already view.
 */
export async function createOrReplaceAnswerNote(
  env: Env,
  ctx: ExecutionContext,
  workspaceCtx: AgentWorkspaceContext,
  rawBody: unknown,
): Promise<CreateAnswerNoteResult> {
  const parsed = parseNoteBody(rawBody);
  if (!parsed.ok) return parsed;

  if (workspaceCtx.chapterIds.length === 0) {
    return { ok: false, error: "no_chapter_membership", status: 403 };
  }

  const actor: WorkspaceActor = {
    userId: workspaceCtx.identity.user.id,
    email: workspaceCtx.identity.user.email,
    isAdmin: workspaceCtx.identity.user.isAdmin,
    chapterIds: workspaceCtx.chapterIds,
  };
  const db = getDb(env);
  const store = createD1WikiWorkspaceStore(db, actor);

  const cited = await resolveCitedPages(store, parsed.body.citedPaths);
  if (!cited.ok) return cited;

  const floor = await computeAccessFloor(db, cited.pages, workspaceCtx);
  if (!floor.ok) return floor;

  if (!canAssignChapter(floor.chapterId, workspaceCtx.identity.user, workspaceCtx.chapterIds)) {
    return { ok: false, error: "forbidden_chapter", status: 403 };
  }

  let replaceId: string | undefined;
  if (parsed.body.replaceId) {
    const existing = await resolveReplaceTarget(db, store, parsed.body.replaceId);
    if (!existing) {
      return { ok: false, error: "not_found", status: 404 };
    }
    const permissions = await getEffectivePagePermissions(
      db,
      existing,
      workspaceCtx.identity.user,
      workspaceCtx.chapterIds,
    );
    if (!permissions.canView) {
      return { ok: false, error: "not_found", status: 404 };
    }

    // A replacement must not move the page's access scope. The UPDATE below
    // rewrites chapter_id, but the page_versions row it inserts preserves the
    // PRIOR content — and wiki.$slug.history.tsx evaluates canView against the
    // page's CURRENT row before returning every version. So relocating an
    // A-scoped answer to chapter B would expose A's prior content to B.
    // Keep the target's scope immutable and require the citations to match it.
    if ((existing.chapterId ?? null) !== floor.chapterId) {
      return { ok: false, error: "replace_scope_mismatch", status: 409 };
    }
    // Explicit per-page ACL rows survive the UPDATE untouched, so they would
    // carry their grantees into whatever the new content is. Refuse instead of
    // reconciling them — the same reasoning as computeAccessFloor.
    const targetAccess = await getPageAccessList(db, existing.id);
    if (targetAccess.length > 0) {
      return { ok: false, error: "replace_target_shared", status: 409 };
    }

    replaceId = existing.id;
  }

  const content = canonicalMarkdown(parsed.body.content);
  const path = `/wiki/${ANSWERS_SLUG}/${parsed.body.slug}`;
  const pageUrl = `${env.APP_URL.replace(/\/$/, "")}${wikiPagePath([ANSWERS_SLUG, parsed.body.slug])}`;
  const userId = workspaceCtx.identity.user.id;

  if (replaceId) {
    const current = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.id, replaceId))
      .get();
    if (!current) return { ok: false, error: "not_found", status: 404 };

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO page_versions (id,page_id,content_ja,content_en,title_ja,title_en,edited_by,saved_at) VALUES (?,?,?,?,?,?,?,unixepoch())",
      ).bind(
        nanoid(),
        replaceId,
        canonicalMarkdown(current.contentJa),
        canonicalMarkdown(current.contentEn),
        current.titleJa,
        current.titleEn,
        userId,
      ),
      env.DB.prepare(
        `UPDATE pages SET
           title_ja = ?, title_en = ?, slug = ?, content_ja = ?, content_en = ?,
           translation_status_ja = 'human', translation_status_en = 'missing',
           summary_ja = ?, summary_en = ?, parent_id = ?, page_type = 'answer',
           visibility = 'restricted', general_role = 'viewer', chapter_id = ?,
           acl_synced_with_parent = 0, acl_source_ids = ?,
           origin = 'agent', last_edited_by = ?, updated_at = unixepoch(),
           sync_revision = sync_revision + 1
         WHERE id = ?`,
      ).bind(
        parsed.body.title,
        parsed.body.title,
        parsed.body.slug,
        content,
        content,
        parsed.body.summary,
        parsed.body.summary,
        NS_ANSWERS,
        floor.chapterId,
        "[]",
        userId,
        replaceId,
      ),
    ]);

    await sendOrRunTranslation(env, ctx, replaceId);
    await upsertCatalogEntry(db, env, {
      section: "Answers",
      slug: parsed.body.slug,
      title: parsed.body.title,
      summary: parsed.body.summary,
    });

    return {
      ok: true,
      status: 200,
      body: { id: replaceId, slug: parsed.body.slug, path, pageUrl, created: false },
    };
  }

  // `pages.slug` is globally UNIQUE, so a read-then-insert is a race: two
  // concurrent filings both see no collision and the loser raises a constraint
  // error (a 500) instead of the documented 409. Let the database arbitrate.
  const id = nanoid();
  const inserted = await env.DB.prepare(
    "INSERT INTO pages (id,title_ja,title_en,slug,content_ja,content_en,translation_status_ja,translation_status_en,summary_ja,summary_en,parent_id,acl_synced_with_parent,sort_order,status,page_type,page_metadata,visibility,general_role,chapter_id,origin,author_id,last_edited_by,acl_source_ids,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch(),unixepoch()) ON CONFLICT(slug) DO NOTHING",
  )
    .bind(
      id,
      parsed.body.title,
      parsed.body.title,
      parsed.body.slug,
      content,
      content,
      "human",
      "missing",
      parsed.body.summary,
      parsed.body.summary,
      NS_ANSWERS,
      0,
      0,
      "published",
      "answer",
      null,
      "restricted",
      "viewer",
      floor.chapterId,
      "agent",
      userId,
      userId,
      "[]",
    )
    .run();

  if (inserted.meta.changes === 0) {
    const existingSlug = await db
      .select({ slug: schema.pages.slug, parentId: schema.pages.parentId })
      .from(schema.pages)
      .where(eq(schema.pages.slug, parsed.body.slug))
      .get();
    // The slug may belong to a page outside answers/ — do not report a path
    // that claims otherwise.
    return {
      ok: false,
      error: "slug_exists",
      status: 409,
      ...(existingSlug?.parentId === NS_ANSWERS
        ? { path: `/wiki/${ANSWERS_SLUG}/${existingSlug.slug}` }
        : {}),
    };
  }

  await sendOrRunTranslation(env, ctx, id);
  await upsertCatalogEntry(db, env, {
    section: "Answers",
    slug: parsed.body.slug,
    title: parsed.body.title,
    summary: parsed.body.summary,
  });

  return {
    ok: true,
    status: 201,
    body: { id, slug: parsed.body.slug, path, pageUrl, created: true },
  };
}

export function parseNoteBody(
  raw: unknown,
): { ok: true; body: NoteRequestBody } | { ok: false; error: string; status: number } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "invalid_body", status: 400 };
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_BODY_KEYS.has(key)) {
      return { ok: false, error: "unknown_field", status: 400 };
    }
  }

  if (typeof record.slug !== "string" || !SLUG_RE.test(record.slug) || record.slug.length > 160) {
    return { ok: false, error: "invalid_slug", status: 400 };
  }
  if (typeof record.title !== "string" || record.title.length === 0 || record.title.length > 200) {
    return { ok: false, error: "invalid_title", status: 400 };
  }
  if (
    typeof record.summary !== "string" ||
    record.summary.length === 0 ||
    record.summary.length > 300
  ) {
    return { ok: false, error: "invalid_summary", status: 400 };
  }
  if (
    typeof record.content !== "string" ||
    record.content.length === 0 ||
    record.content.length > 8000
  ) {
    return { ok: false, error: "invalid_content", status: 400 };
  }
  if (!Array.isArray(record.citedPaths)) {
    return { ok: false, error: "invalid_citation", status: 400 };
  }
  if (record.citedPaths.length < 2 || record.citedPaths.length > 12) {
    return { ok: false, error: "invalid_citation", status: 400 };
  }
  if (!record.citedPaths.every((p) => typeof p === "string" && p.length > 0)) {
    return { ok: false, error: "invalid_citation", status: 400 };
  }
  if (record.replaceId !== undefined && typeof record.replaceId !== "string") {
    return { ok: false, error: "invalid_replace_id", status: 400 };
  }

  return {
    ok: true,
    body: {
      slug: record.slug,
      title: record.title,
      summary: record.summary,
      content: record.content,
      citedPaths: record.citedPaths as string[],
      ...(typeof record.replaceId === "string" ? { replaceId: record.replaceId } : {}),
    },
  };
}

type CitedPage = {
  id: string;
  chapterId: string | null;
};

async function resolveCitedPages(
  store: ReturnType<typeof createD1WikiWorkspaceStore>,
  citedPaths: readonly string[],
): Promise<{ ok: true; pages: CitedPage[] } | { ok: false; error: string; status: number }> {
  const pages: CitedPage[] = [];
  for (const rawPath of citedPaths) {
    let absolute: string;
    try {
      absolute = normaliseAbsoluteWorkspacePath(rawPath);
    } catch {
      return { ok: false, error: "invalid_citation", status: 400 };
    }
    if (!absolute.startsWith("/wiki/")) {
      return { ok: false, error: "invalid_citation", status: 400 };
    }
    const relative = absolute.slice("/wiki/".length);
    if (!relative) return { ok: false, error: "invalid_citation", status: 400 };

    const page = await resolveWikiWorkspacePage(store, relative);
    if (!page || !(await store.canView(page))) {
      return { ok: false, error: "invalid_citation", status: 400 };
    }
    pages.push({ id: page.id, chapterId: page.chapterId });
  }
  return { ok: true, pages };
}

/**
 * A filed note must never be readable by anyone who could not have read its
 * inputs. Refuse rather than intersecting ACLs — copying access lists is a
 * feature in its own right, and a subtle bug there leaks restricted pages.
 */
export async function computeAccessFloor(
  db: ReturnType<typeof getDb>,
  pages: readonly CitedPage[],
  workspaceCtx: AgentWorkspaceContext,
): Promise<{ ok: true; chapterId: string | null } | { ok: false; error: string; status: number }> {
  for (const page of pages) {
    const access = await getPageAccessList(db, page.id);
    if (access.length > 0) {
      return { ok: false, error: "citations_span_access", status: 409 };
    }
  }

  const chapterIds = [
    ...new Set(pages.map((page) => page.chapterId).filter((id): id is string => id != null)),
  ];
  const allNull = pages.every((page) => page.chapterId == null);

  if (chapterIds.length > 1) {
    return { ok: false, error: "citations_span_chapters", status: 409 };
  }
  if (chapterIds.length === 1) {
    return { ok: true, chapterId: chapterIds[0] };
  }
  if (allNull) {
    if (workspaceCtx.chapterIds.length === 1) {
      return { ok: true, chapterId: workspaceCtx.chapterIds[0] };
    }
    return { ok: false, error: "chapter_ambiguous", status: 409 };
  }
  // Mixed null + one chapter should not happen given the sets above, but refuse.
  return { ok: false, error: "citations_span_chapters", status: 409 };
}

/**
 * `replaceId` is normally a page id. The filing pass may also send an answers
 * workspace path (`/wiki/answers/<slug>`) when that is all the tool trace has.
 */
async function resolveReplaceTarget(
  db: ReturnType<typeof getDb>,
  store: ReturnType<typeof createD1WikiWorkspaceStore>,
  replaceId: string,
) {
  const byId = await db.select().from(schema.pages).where(eq(schema.pages.id, replaceId)).get();
  if (byId) {
    if (byId.parentId !== NS_ANSWERS || byId.pageType !== "answer" || byId.origin !== "agent") {
      return null;
    }
    return byId;
  }

  let absolute: string;
  try {
    absolute = normaliseAbsoluteWorkspacePath(replaceId);
  } catch {
    return null;
  }
  if (!absolute.startsWith(`/wiki/${ANSWERS_SLUG}/`)) return null;
  const relative = absolute.slice("/wiki/".length);
  const page = await resolveWikiWorkspacePage(store, relative);
  if (!page || !(await store.canView(page))) return null;

  const row = await db.select().from(schema.pages).where(eq(schema.pages.id, page.id)).get();
  if (!row || row.parentId !== NS_ANSWERS || row.pageType !== "answer" || row.origin !== "agent") {
    return null;
  }
  return row;
}
