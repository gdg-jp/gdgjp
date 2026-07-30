import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import * as schema from "~/db/schema";
import { getCliIdentity } from "~/lib/cli-identity.server";
import { canonicalMarkdown } from "~/lib/content-format";
import { getDb } from "~/lib/db.server";
import { getEffectivePagePermissions, isGeneralAccess, isPageRole } from "~/lib/page-access.server";
import type { components } from "../../openapi/types.generated";

type WikiSyncRequest = components["schemas"]["SyncRequest"];
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
const Source = z.object({ url: z.string().url(), title: z.string() });
const Attachment = z.object({
  id: z.string().optional(),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
});
const PagePayload = z.object({
  id: z.string().optional(),
  slug: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  parentId: z.string().nullable(),
  sortOrder: z.number().int().min(0),
  ja: Language,
  en: Language,
  meta: z.object({
    status: z.enum(["draft", "published"]),
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
});
const Body = z.object({
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
    .min(1),
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
  const syncRequest = parsed.data as WikiSyncRequest;
  const db = getDb(env);
  const existingIds = syncRequest.operations.flatMap((op) =>
    op.kind === "archive" ? [op.id] : op.page.id ? [op.page.id] : [],
  );
  const existing = existingIds.length
    ? await db.select().from(schema.pages).where(inArray(schema.pages.id, existingIds)).all()
    : [];
  const byId = new Map(existing.map((page) => [page.id, page]));
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

  // Validate all conditions before building D1's transactional batch.
  for (const operation of syncRequest.operations) {
    const id = operation.kind === "archive" ? operation.id : operation.page.id;
    const current = id ? byId.get(id) : undefined;
    if (id && !current) return Response.json({ error: "not_found", id }, { status: 404 });
    if (current) {
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
  const objectsToDelete: string[] = [];
  const returned: Array<{ id: string; slug: string; attachmentIds: Record<string, string> }> = [];
  for (const operation of syncRequest.operations) {
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
    // Parent must exist (or be created in this request), must not be the page,
    // and cannot point at a task list. This prevents hierarchy corruption.
    if (page.parentId === id)
      return Response.json({ error: "circular_parent", id }, { status: 400 });
    if (page.parentId) {
      const parent =
        byId.get(page.parentId) ??
        (await db.select().from(schema.pages).where(eq(schema.pages.id, page.parentId)).get());
      if (!parent || parent.pageType === "task-list")
        return Response.json({ error: "invalid_parent", id: page.parentId }, { status: 400 });
      const parentPermissions = await getEffectivePagePermissions(
        db,
        parent,
        identity.user,
        chapterIds,
      );
      if (!parentPermissions.canEdit)
        return Response.json({ error: "parent_forbidden", id: page.parentId }, { status: 403 });
    }
    const meta = page.meta;
    const contentJa = canonicalMarkdown(page.ja.content);
    const contentEn = canonicalMarkdown(page.en.content);
    if (!isGeneralAccess(meta.visibility) || !isPageRole(meta.generalRole))
      return Response.json({ error: "invalid_access" }, { status: 400 });
    if (meta.pageType === "task-list")
      return Response.json({ error: "task_list_unsupported" }, { status: 400 });
    if (!current) {
      if (meta.status !== "published")
        return Response.json({ error: "new_pages_must_be_published" }, { status: 400 });
      statements.push(
        env.DB.prepare(
          "INSERT INTO pages (id,title_ja,title_en,slug,content_ja,content_en,translation_status_ja,translation_status_en,summary_ja,summary_en,parent_id,sort_order,status,page_type,page_metadata,visibility,general_role,chapter_id,author_id,last_edited_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch(),unixepoch())",
        ).bind(
          id,
          page.ja.title,
          page.en.title,
          page.slug,
          contentJa,
          contentEn,
          page.ja.translationStatus,
          page.en.translationStatus,
          page.ja.summary,
          page.en.summary,
          page.parentId,
          page.sortOrder,
          meta.status,
          meta.pageType,
          meta.pageMetadata === null ? null : JSON.stringify(meta.pageMetadata),
          meta.visibility,
          meta.generalRole,
          meta.chapterId,
          identity.user.id,
          identity.user.id,
        ),
      );
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
      statements.push(
        env.DB.prepare(
          "UPDATE pages SET title_ja=?,title_en=?,slug=?,content_ja=?,content_en=?,translation_status_ja=?,translation_status_en=?,summary_ja=?,summary_en=?,parent_id=?,sort_order=?,status=?,page_type=?,page_metadata=?,visibility=?,general_role=?,chapter_id=?,last_edited_by=?,updated_at=unixepoch() WHERE id=? AND sync_revision=?",
        ).bind(
          page.ja.title,
          page.en.title,
          page.slug,
          contentJa,
          contentEn,
          page.ja.translationStatus,
          page.en.translationStatus,
          page.ja.summary,
          page.en.summary,
          page.parentId,
          page.sortOrder,
          meta.status,
          meta.pageType,
          meta.pageMetadata === null ? null : JSON.stringify(meta.pageMetadata),
          meta.visibility,
          meta.generalRole,
          meta.chapterId,
          identity.user.id,
          id,
          operation.expectedRevision,
        ),
      );
    }
    // Front matter arrays are replacement sets.  Tags must already exist.
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
          "INSERT INTO page_sources (id,page_id,url,title,created_at) VALUES (?,?,?,?,unixepoch())",
        ).bind(nanoid(), id, source.url, source.title),
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
  }
  try {
    await env.DB.batch(statements);
  } catch (error) {
    return Response.json(
      { error: "sync_failed", message: error instanceof Error ? error.message : "database error" },
      { status: 400 },
    );
  }
  // D1 is authoritative; R2 objects are removed only after that transaction
  // commits. A failed R2 deletion leaves an unreachable object, never a stale
  // attachment visible through the wiki.
  await Promise.all(objectsToDelete.map((key) => env.BUCKET.delete(key)));
  const revisions = await db
    .select({ id: schema.pages.id, revision: schema.pages.syncRevision })
    .from(schema.pages)
    .where(
      inArray(
        schema.pages.id,
        returned.map((x) => x.id),
      ),
    )
    .all();
  const syncResult: WikiSyncResult = {
    ok: true,
    pages: returned.map((page) => ({
      ...page,
      revision: revisions.find((r) => r.id === page.id)?.revision,
    })),
  };
  return Response.json(syncResult);
}
