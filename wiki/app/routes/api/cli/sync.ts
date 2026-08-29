import { getBearerIdentity } from "@gdgjp/gdg-lib";
import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { ActionFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { agentsHash, getAgentInstructions } from "~/features/agent-api/agents-md.server";
import { humanParentSyncError } from "~/features/agent-api/cli-sync-helpers";
import { SyncBody } from "~/features/agent-api/cli-sync-schema";
import type { WikiSyncResult } from "~/features/agent-api/cli-sync-schema";
import {
  buildSyncPageWriteStatements,
  preflightSyncOperations,
  resolveSyncPageSharing,
  scheduleSyncPostCommit,
} from "~/features/agent-api/cli-sync.server";
import { canonicalMarkdown } from "~/features/editor/content-format";
import {
  getEffectivePagePermissions,
  isGeneralAccess,
  isPageRole,
} from "~/features/pages/access.server";
import { computeAclSourceIdsJson } from "~/features/pages/acl-spans";
import { pageAclClearance, validatePageAclForSync } from "~/features/pages/acl-spans.server";
import { D1_MAX_BOUND_PARAMETERS, mapInChunks } from "~/features/pages/d1-chunk.server";
import { getDb } from "~/lib/db.server";
import { sendOrRunTranslation } from "~/lib/queue-processors.server";

/** POST /api/cli/wiki/sync
 * Atomically applies page upserts/archives.  Every existing operation must
 * carry the revision received from snapshot; a stale request returns 409 and
 * applies nothing.  Attachments listed without an id are allocated here, then
 * uploaded with PUT /api/cli/wiki/attachments/:attachmentId.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const { env } = context.cloudflare;
  const identity = await getBearerIdentity(request, env.ACCOUNTS_URL);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });
  const parsed = SyncBody.safeParse(await request.json());
  if (!parsed.success)
    return Response.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  const operations = parsed.data.operations;
  const agentsUpdate = parsed.data.agentsMd;
  const suppliedIds = operations.flatMap((operation) =>
    operation.kind === "archive" ? [operation.id] : operation.page.id ? [operation.page.id] : [],
  );
  if (new Set(suppliedIds).size !== suppliedIds.length)
    return Response.json({ error: "duplicate_page_id" }, { status: 400 });
  const db = getDb(env);
  if (agentsUpdate && !identity.user.isAdmin)
    return Response.json({ error: "agents_md_forbidden" }, { status: 403 });
  const currentAgents = agentsUpdate ? await getAgentInstructions(db) : null;
  if (agentsUpdate && !currentAgents)
    return Response.json({ error: "agents_md_unavailable" }, { status: 503 });
  if (agentsUpdate && currentAgents?.contentHash !== agentsUpdate.expectedContentHash)
    return Response.json(
      { error: "agents_md_conflict", contentHash: currentAgents?.contentHash },
      { status: 409 },
    );
  // CLI identity uses the OIDC `sub` as `user.id`, but wiki rows are keyed by
  // the local user primary key (linked via email / oidc_subject). Resolve that
  // key before writing `wiki_agent_instructions.updated_by` (FK-enforced).
  let agentsUpdatedBy: string | null = null;
  if (agentsUpdate) {
    const byEmail = identity.user.email
      ? await db
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(eq(schema.user.email, identity.user.email))
          .get()
      : null;
    const byId = byEmail
      ? null
      : await db
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(eq(schema.user.id, identity.user.id))
          .get();
    agentsUpdatedBy = byEmail?.id ?? byId?.id ?? null;
    if (!agentsUpdatedBy)
      return Response.json({ error: "agents_md_user_missing" }, { status: 403 });
  }
  const existingIds = operations.flatMap((op) =>
    op.kind === "archive" ? [op.id] : op.page.id ? [op.page.id] : [],
  );
  // D1 caps bound parameters at 100 — a large git push (e.g. lint across many
  // pages) must load existing rows in chunks or the sync action 500s.
  const existing = await mapInChunks(existingIds, (chunk) =>
    db.select().from(schema.pages).where(inArray(schema.pages.id, chunk)).all(),
  );
  const byId = new Map(existing.map((page) => [page.id, page]));
  const requestedById = new Map(
    operations.flatMap((operation) =>
      operation.kind === "upsert" && operation.page.id
        ? [[operation.page.id, operation.page] as const]
        : [],
    ),
  );
  const existingAccess = await mapInChunks(existingIds, (chunk) =>
    db.select().from(schema.pageAccess).where(inArray(schema.pageAccess.pageId, chunk)).all(),
  );
  const existingAttachments = await mapInChunks(existingIds, (chunk) =>
    db
      .select()
      .from(schema.pageAttachments)
      .where(inArray(schema.pageAttachments.pageId, chunk))
      .all(),
  );
  const translatePageIds = new Set<string>();

  const preflight = await preflightSyncOperations(db, operations, byId, existingAccess, identity);
  if (preflight) return preflight;

  const statements: D1PreparedStatement[] = [];
  if (agentsUpdate) {
    if (!agentsUpdatedBy)
      return Response.json({ error: "agents_md_user_missing" }, { status: 403 });
    statements.push(
      env.DB.prepare(
        "UPDATE wiki_agent_instructions SET content=?, content_hash=?, updated_by=?, updated_at=unixepoch() WHERE id=1 AND content_hash=?",
      ).bind(
        agentsUpdate.content,
        agentsHash(agentsUpdate.content),
        agentsUpdatedBy,
        agentsUpdate.expectedContentHash,
      ),
      // D1 batches are atomic. A malformed JSON expression aborts the entire
      // batch if a concurrent writer changed the row after the preflight.
      env.DB.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('') END"),
    );
  }
  const objectsToDelete: string[] = [];
  const returned: Array<{ id: string; slug: string; attachmentIds: Record<string, string> }> = [];
  const createdRequestIds = new Set<string>();
  for (const operation of operations) {
    if (operation.kind === "archive") {
      statements.push(
        env.DB.prepare(
          `WITH RECURSIVE descendants(id) AS (
             SELECT id FROM pages WHERE id = ? AND sync_revision = ?
             UNION
             SELECT pages.id FROM pages JOIN descendants ON pages.parent_id = descendants.id
           )
           UPDATE pages SET status = 'archived', last_edited_by = ?, updated_at = unixepoch()
           WHERE id IN (SELECT id FROM descendants)`,
        ).bind(operation.id, operation.expectedRevision, identity.user.id),
      );
      returned.push({
        id: operation.id,
        slug: byId.get(operation.id)?.slug ?? "",
        attachmentIds: {},
      });
      continue;
    }
    const { page } = operation;
    const id = page.id ?? nanoid();
    const current = page.id ? byId.get(page.id) : undefined;
    if (page.parentId === id)
      return Response.json({ error: "circular_parent", id }, { status: 400 });
    if (page.parentId) {
      const requestedParent = requestedById.get(page.parentId);
      const storedParent =
        byId.get(page.parentId) ??
        (await db.select().from(schema.pages).where(eq(schema.pages.id, page.parentId)).get());
      if (!storedParent && !requestedParent)
        return Response.json({ error: "invalid_parent", id: page.parentId }, { status: 400 });
      if (!storedParent && requestedParent && !createdRequestIds.has(page.parentId))
        return Response.json({ error: "invalid_parent_order", id: page.parentId }, { status: 400 });
      if (storedParent) {
        if (storedParent.pageType === "task-list")
          return Response.json({ error: "invalid_parent", id: page.parentId }, { status: 400 });
        const parentError = humanParentSyncError(storedParent.origin);
        if (parentError)
          return Response.json({ error: parentError, id: page.parentId }, { status: 400 });
        const parentPermissions = await getEffectivePagePermissions(
          db,
          storedParent,
          identity.user,
          identity.chapters,
        );
        if (!parentPermissions.canEdit)
          return Response.json({ error: "parent_forbidden", id: page.parentId }, { status: 403 });
      } else if (requestedParent?.meta.pageType === "task-list") {
        return Response.json({ error: "invalid_parent", id: page.parentId }, { status: 400 });
      }
    }
    const meta = page.meta;
    const contentJa = page.ja ? canonicalMarkdown(page.ja.content) : undefined;
    const contentEn = page.en ? canonicalMarkdown(page.en.content) : undefined;
    if (!isGeneralAccess(meta.visibility) || !isPageRole(meta.generalRole))
      return Response.json({ error: "invalid_access" }, { status: 400 });
    if (meta.pageType === "task-list")
      return Response.json({ error: "task_list_unsupported" }, { status: 400 });

    const sharing = resolveSyncPageSharing(current, existingAccess, meta);
    if (sharing instanceof Response) return sharing;
    const { effectiveMeta, resolvedSharing } = sharing;

    if (current) {
      const canEditSpans = await pageAclClearance(
        db,
        [current.contentJa, current.contentEn],
        identity.user,
        identity.chapters,
      );
      if (!canEditSpans) {
        return Response.json({ error: "redacted_page_not_editable", id }, { status: 403 });
      }
    }

    const aclValidation = await validatePageAclForSync(
      db,
      {
        ja: page.ja
          ? {
              title: page.ja.title,
              summary: page.ja.summary,
              content: contentJa,
              tags: effectiveMeta.tags,
            }
          : undefined,
        en: page.en
          ? {
              title: page.en.title,
              summary: page.en.summary,
              content: contentEn,
              tags: effectiveMeta.tags,
            }
          : undefined,
      },
      {
        pageVisibility: effectiveMeta.visibility,
        pageAccess: effectiveMeta.access,
        citedSourceIds: effectiveMeta.sources
          .map((source) => source.sourceId)
          .filter(
            (sourceId): sourceId is string => typeof sourceId === "string" && sourceId.length > 0,
          ),
        storedContentJa: current?.contentJa,
        storedContentEn: current?.contentEn,
        contentJa,
        contentEn,
      },
      identity.user,
      identity.chapters,
    );
    if (!aclValidation.ok) {
      return Response.json(
        {
          error: aclValidation.error,
          id,
          ...(aclValidation.sourceId ? { sourceId: aclValidation.sourceId } : {}),
        },
        { status: 400 },
      );
    }

    // Partial-locale sync must union both locales — never drop the other side's ids.
    const aclSourceIdsJson = computeAclSourceIdsJson(
      contentJa ?? current?.contentJa ?? "",
      contentEn ?? current?.contentEn ?? "",
    );

    const written = await buildSyncPageWriteStatements({
      db,
      env,
      page,
      current,
      id,
      effectiveMeta,
      contentJa,
      contentEn,
      aclSourceIdsJson,
      resolvedSharing,
      expectedRevision: operation.expectedRevision,
      existingAttachments,
      identity,
      statements,
      objectsToDelete,
      translatePageIds,
    });
    if (written instanceof Response) return written;
    returned.push({ id, slug: page.slug, attachmentIds: written.attachmentIds });
    if (!current) createdRequestIds.add(id);
  }
  let revisions: Array<{ id: string; revision: number }>;
  try {
    if (returned.length) {
      const revisionStatements: D1PreparedStatement[] = [];
      for (let i = 0; i < returned.length; i += D1_MAX_BOUND_PARAMETERS) {
        const chunk = returned.slice(i, i + D1_MAX_BOUND_PARAMETERS);
        const placeholders = chunk.map(() => "?").join(",");
        revisionStatements.push(
          env.DB.prepare(
            `SELECT id, sync_revision AS revision FROM pages WHERE id IN (${placeholders})`,
          ).bind(...chunk.map((page) => page.id)),
        );
      }
      const results = await env.DB.batch([...statements, ...revisionStatements]);
      revisions = revisionStatements.flatMap((_, index) => {
        const row = results[statements.length + index];
        return (row?.results ?? []) as Array<{ id: string; revision: number }>;
      });
    } else {
      await env.DB.batch(statements);
      revisions = [];
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("malformed JSON"))
      return Response.json({ error: "agents_md_conflict" }, { status: 409 });
    return Response.json(
      { error: "sync_failed", message: error instanceof Error ? error.message : "database error" },
      { status: 400 },
    );
  }
  const { ctx } = context.cloudflare;
  scheduleSyncPostCommit(ctx, [
    ...objectsToDelete.map((key) => env.BUCKET.delete(key)),
    ...[...translatePageIds].map((pageId) => sendOrRunTranslation(env, ctx, pageId)),
  ]);
  const syncResult: WikiSyncResult = {
    ok: true,
    pages: returned.map((page) => ({
      ...page,
      revision: revisions.find((r) => r.id === page.id)?.revision,
    })),
  };
  return Response.json(syncResult);
}
