import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import * as schema from "~/db/schema";
import { agentsHash, getAgentInstructions } from "~/lib/agents-md.server";
import { getCliIdentity } from "~/lib/cli-identity.server";
import { canonicalMarkdown } from "~/lib/content-format";
import { getDb } from "~/lib/db.server";
import { getEffectivePagePermissions, isGeneralAccess, isPageRole } from "~/lib/page-access.server";
import { sendOrRunTranslation } from "~/lib/queue-processors.server";
import type { components } from "../../openapi/types.generated";
import {
  buildNewPageLocaleValues,
  buildPartialLocaleUpdate,
  humanOriginSyncError,
  humanParentSyncError,
  jaContentChanged,
  sourceHasReference,
} from "./api.cli.wiki.sync.helpers";

type WikiSyncResult = components["schemas"]["SyncResult"];

const Language = z.object({
  title: z.string(),
  summary: z.string(),
  translationStatus: z.enum(["human", "ai", "missing"]),
  content: z.string(),
});
const Access = z.object({
  subjectType: z.enum(["email", "chapter"]),
  subjectKey: z.string().min(1),
  subjectLabel: z.string(),
  role: z.enum(["viewer", "commenter", "editor"]),
});
const Source = z
  .object({
    id: z.string().optional(),
    url: z.string().optional(),
    title: z.string(),
    sourceId: z.string().nullable().optional(),
  })
  .refine(sourceHasReference, { message: "source requires title and url or sourceId" });
const Attachment = z.object({
  id: z.string().optional(),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
});
const PagePayload = z
  .object({
    id: z.string().min(1).max(128).optional(),
    slug: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    parentId: z.string().nullable(),
    sortOrder: z.number().int().min(0),
    ja: Language.optional(),
    en: Language.optional(),
    meta: z.object({
      pageType: z.string().nullable(),
      pageMetadata: z.unknown().nullable(),
      visibility: z.enum(["restricted", "unlisted", "public"]),
      generalRole: z.enum(["viewer", "commenter", "editor"]),
      chapterId: z.string().nullable(),
      tags: z.array(z.string().min(1)),
      access: z.array(Access),
      sources: z.array(Source),
      attachments: z.array(Attachment),
    }),
  })
  .refine((page) => page.ja || page.en, { message: "one locale is required" });
const AgentInstructionsUpdate = z.object({
  content: z.string().min(1).max(262144),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
const Body = z
  .object({
    operations: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("upsert"),
            expectedRevision: z.number().int().positive().optional(),
            page: PagePayload,
          }),
          z.object({
            kind: z.literal("archive"),
            id: z.string(),
            expectedRevision: z.number().int().positive(),
          }),
        ]),
      )
      .default([]),
    agentsMd: AgentInstructionsUpdate.optional(),
  })
  .refine((body) => body.operations.length > 0 || body.agentsMd, {
    message: "operations or agentsMd is required",
  });

/** POST /api/cli/wiki/sync
 * Atomically applies page upserts/archives.  Every existing operation must
 * carry the revision received from snapshot; a stale request returns 409 and
 * applies nothing.  Attachments listed without an id are allocated here, then
 * uploaded with PUT /api/cli/wiki/attachments/:attachmentId.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const { env } = context.cloudflare;
  const identity = await getCliIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });
  const parsed = Body.safeParse(await request.json());
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
  const existingIds = operations.flatMap((op) =>
    op.kind === "archive" ? [op.id] : op.page.id ? [op.page.id] : [],
  );
  const existing = existingIds.length
    ? await db.select().from(schema.pages).where(inArray(schema.pages.id, existingIds)).all()
    : [];
  const byId = new Map(existing.map((page) => [page.id, page]));
  const requestedById = new Map(
    operations.flatMap((operation) =>
      operation.kind === "upsert" && operation.page.id
        ? [[operation.page.id, operation.page] as const]
        : [],
    ),
  );
  const existingAccess = existingIds.length
    ? await db
        .select()
        .from(schema.pageAccess)
        .where(inArray(schema.pageAccess.pageId, existingIds))
        .all()
    : [];
  const existingAttachments = existingIds.length
    ? await db
        .select()
        .from(schema.pageAttachments)
        .where(inArray(schema.pageAttachments.pageId, existingIds))
        .all()
    : [];
  const chapterIds = identity.chapters.map((chapter) => String(chapter.chapterId));
  const conflicts: Array<{ id: string; revision: number }> = [];
  const translatePageIds = new Set<string>();

  for (const operation of operations) {
    const id = operation.kind === "archive" ? operation.id : operation.page.id;
    const current = id ? byId.get(id) : undefined;
    if (
      id &&
      !current &&
      (operation.kind === "archive" || operation.expectedRevision !== undefined)
    )
      return Response.json({ error: "not_found", id }, { status: 404 });
    if (current) {
      const originError = humanOriginSyncError(current.origin);
      if (originError) return Response.json({ error: originError, id }, { status: 403 });
      if (current.pageType === "task-list")
        return Response.json({ error: "task_list_unsupported", id }, { status: 400 });
      const permission = await getEffectivePagePermissions(db, current, identity.user, chapterIds);
      if (!permission.canEdit) return Response.json({ error: "forbidden", id }, { status: 403 });
      const expected = operation.expectedRevision;
      if (expected !== current.syncRevision)
        conflicts.push({ id: current.id, revision: current.syncRevision });
      if (operation.kind === "upsert") {
        const requestedAccess = operation.page.meta.access
          .map(
            (entry) =>
              `${entry.subjectType}\u0000${entry.subjectKey}\u0000${entry.subjectLabel}\u0000${entry.role}`,
          )
          .sort();
        const storedAccess = existingAccess
          .filter((entry) => entry.pageId === current.id)
          .map(
            (entry) =>
              `${entry.subjectType}\u0000${entry.subjectKey}\u0000${entry.subjectLabel}\u0000${entry.role}`,
          )
          .sort();
        const sharingChanged =
          current.visibility !== operation.page.meta.visibility ||
          current.generalRole !== operation.page.meta.generalRole ||
          current.chapterId !== operation.page.meta.chapterId ||
          requestedAccess.join("\n") !== storedAccess.join("\n");
        if (sharingChanged && !permission.canManageSharing)
          return Response.json({ error: "sharing_forbidden", id }, { status: 403 });
      }
    }
  }
  if (conflicts.length)
    return Response.json({ error: "revision_conflict", conflicts }, { status: 409 });

  const statements: D1PreparedStatement[] = [];
  if (agentsUpdate) {
    statements.push(
      env.DB.prepare(
        "UPDATE wiki_agent_instructions SET content=?, content_hash=?, updated_by=?, updated_at=unixepoch() WHERE id=1 AND content_hash=?",
      ).bind(
        agentsUpdate.content,
        agentsHash(agentsUpdate.content),
        identity.user.id,
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
          chapterIds,
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
    if (!current) {
      const localeValues = buildNewPageLocaleValues({
        ...page,
        meta,
      });
      statements.push(
        env.DB.prepare(
          "INSERT INTO pages (id,title_ja,title_en,slug,content_ja,content_en,translation_status_ja,translation_status_en,summary_ja,summary_en,parent_id,sort_order,status,page_type,page_metadata,visibility,general_role,chapter_id,origin,author_id,last_edited_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch(),unixepoch())",
        ).bind(
          id,
          localeValues.titleJa,
          localeValues.titleEn,
          page.slug,
          contentJa ?? "",
          contentEn ?? "",
          localeValues.translationStatusJa,
          localeValues.translationStatusEn,
          localeValues.summaryJa,
          localeValues.summaryEn,
          page.parentId,
          page.sortOrder,
          "published",
          meta.pageType,
          meta.pageMetadata === null ? null : JSON.stringify(meta.pageMetadata),
          meta.visibility,
          meta.generalRole,
          meta.chapterId,
          "agent",
          identity.user.id,
          identity.user.id,
        ),
      );
      if (page.ja) translatePageIds.add(id);
    } else {
      statements.push(
        env.DB.prepare(
          "INSERT INTO page_versions (id,page_id,content_ja,content_en,title_ja,title_en,edited_by,saved_at) VALUES (?,?,?,?,?,?,?,unixepoch())",
        ).bind(
          nanoid(),
          id,
          canonicalMarkdown(current.contentJa),
          canonicalMarkdown(current.contentEn),
          current.titleJa,
          current.titleEn,
          identity.user.id,
        ),
      );
      const update = buildPartialLocaleUpdate(
        { ...page, meta },
        contentJa,
        contentEn,
        identity.user.id,
        id,
        operation.expectedRevision,
      );
      statements.push(env.DB.prepare(update.sql).bind(...update.binds));
      if (jaContentChanged(current, page.ja, contentJa)) translatePageIds.add(id);
    }
    if (meta.tags.length) {
      const known = await db
        .select({ slug: schema.tags.slug })
        .from(schema.tags)
        .where(inArray(schema.tags.slug, meta.tags))
        .all();
      if (known.length !== new Set(meta.tags).size)
        return Response.json({ error: "unknown_tag" }, { status: 400 });
    }
    statements.push(
      env.DB.prepare("DELETE FROM page_tags WHERE page_id = ?").bind(id),
      env.DB.prepare("DELETE FROM page_access WHERE page_id = ?").bind(id),
      env.DB.prepare("DELETE FROM page_sources WHERE page_id = ?").bind(id),
    );
    for (const tag of [...new Set(meta.tags)])
      statements.push(
        env.DB.prepare("INSERT INTO page_tags (page_id,tag_slug) VALUES (?,?)").bind(id, tag),
      );
    for (const entry of meta.access)
      statements.push(
        env.DB.prepare(
          "INSERT INTO page_access (id,page_id,subject_type,subject_key,subject_label,user_id,role,granted_by,created_at,updated_at) VALUES (?,?,?,?,?,NULL,?,?,unixepoch(),unixepoch())",
        ).bind(
          nanoid(),
          id,
          entry.subjectType,
          entry.subjectKey,
          entry.subjectLabel,
          entry.role,
          identity.user.id,
        ),
      );
    for (const source of meta.sources)
      statements.push(
        env.DB.prepare(
          "INSERT INTO page_sources (id,page_id,url,title,source_id,created_at) VALUES (?,?,?,?,?,unixepoch())",
        ).bind(source.id ?? nanoid(), id, source.url ?? "", source.title, source.sourceId ?? null),
      );
    const attachmentIds: Record<string, string> = {};
    const requestedIds = new Set(meta.attachments.flatMap((a) => (a.id ? [a.id] : [])));
    if (current) {
      const currentAttachments = existingAttachments.filter(
        (attachment) => attachment.pageId === id,
      );
      const unknownAttachment = [...requestedIds].find(
        (attachmentId) => !currentAttachments.some((attachment) => attachment.id === attachmentId),
      );
      if (unknownAttachment)
        return Response.json(
          { error: "unknown_attachment", id: unknownAttachment },
          { status: 400 },
        );
      objectsToDelete.push(
        ...currentAttachments
          .filter((attachment) => !requestedIds.has(attachment.id))
          .map((attachment) => attachment.r2Key),
      );
      statements.push(
        env.DB.prepare(
          `DELETE FROM page_attachments WHERE page_id = ? AND id NOT IN (${requestedIds.size ? [...requestedIds].map(() => "?").join(",") : "''"})`,
        ).bind(id, ...requestedIds),
      );
    }
    for (const attachment of meta.attachments) {
      const attachmentId = attachment.id ?? nanoid();
      attachmentIds[attachment.fileName] = attachmentId;
      const r2Key = `wiki/${id}/${attachmentId}-${attachment.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      if (attachment.id)
        statements.push(
          env.DB.prepare(
            "UPDATE page_attachments SET file_name=?, mime_type=? WHERE id=? AND page_id=?",
          ).bind(attachment.fileName, attachment.mimeType, attachmentId, id),
        );
      else
        statements.push(
          env.DB.prepare(
            "INSERT INTO page_attachments (id,page_id,r2_key,file_name,mime_type,created_at) VALUES (?,?,?,?,?,unixepoch())",
          ).bind(attachmentId, id, r2Key, attachment.fileName, attachment.mimeType),
        );
    }
    returned.push({ id, slug: page.slug, attachmentIds });
    if (!current) createdRequestIds.add(id);
  }
  let revisions: Array<{ id: string; revision: number }>;
  try {
    if (returned.length) {
      const placeholders = returned.map(() => "?").join(",");
      const revisionStatement = env.DB.prepare(
        `SELECT id, sync_revision AS revision FROM pages WHERE id IN (${placeholders})`,
      ).bind(...returned.map((page) => page.id));
      const results = await env.DB.batch([...statements, revisionStatement]);
      revisions = (results.at(-1)?.results ?? []) as Array<{ id: string; revision: number }>;
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

/** Post-commit cleanup must never turn an already-committed sync into a 5xx. */
export function scheduleSyncPostCommit(context: ExecutionContext, tasks: Promise<unknown>[]): void {
  if (tasks.length === 0) return;
  context.waitUntil(
    Promise.allSettled(tasks).then((results) => {
      for (const result of results) {
        if (result.status === "rejected")
          console.error(
            JSON.stringify({
              message: "Wiki sync post-commit task failed",
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            }),
          );
      }
    }),
  );
}
