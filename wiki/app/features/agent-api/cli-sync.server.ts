import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import {
  buildNewPageLocaleValues,
  buildPartialLocaleUpdate,
  jaContentChanged,
  resolveExistingPageSharing,
} from "~/features/agent-api/cli-sync-helpers";
import { humanOriginSyncError } from "~/features/agent-api/cli-sync-helpers";
import { canonicalMarkdown } from "~/features/editor/content-format";
import {
  getEffectivePagePermissions,
  isGeneralAccess,
  isPageRole,
} from "~/features/pages/access.server";
import type { getDb } from "~/lib/db.server";
import type { SyncOperation, SyncPagePayload } from "./cli-sync-schema";

type Db = ReturnType<typeof getDb>;
type PageRow = typeof schema.pages.$inferSelect;
type AccessRow = typeof schema.pageAccess.$inferSelect;
type AttachmentRow = typeof schema.pageAttachments.$inferSelect;
type BearerIdentity = {
  user: { id: string; email?: string | null; isAdmin: boolean };
  chapters: Array<{ chapterId: string | number; role: string }>;
};

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

/**
 * Per-operation preflight: permission, page-type, origin, and revision checks.
 * Returns an error `Response` to short-circuit the action, or `null` when every
 * operation may proceed (revision conflicts are reported as a single 409).
 */
export async function preflightSyncOperations(
  db: Db,
  operations: readonly SyncOperation[],
  byId: Map<string, PageRow>,
  existingAccess: readonly AccessRow[],
  identity: BearerIdentity,
): Promise<Response | null> {
  const conflicts: Array<{ id: string; revision: number }> = [];

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
      const permission = await getEffectivePagePermissions(
        db,
        current,
        identity.user,
        identity.chapters,
      );
      if (!permission.canEdit) return Response.json({ error: "forbidden", id }, { status: 403 });
      const expected = operation.expectedRevision;
      if (expected !== current.syncRevision)
        conflicts.push({ id: current.id, revision: current.syncRevision });
      if (operation.kind === "upsert") {
        const storedAccess = existingAccess
          .filter((entry) => entry.pageId === current.id)
          .map((entry) => ({
            subjectType: entry.subjectType as "email" | "chapter",
            subjectKey: entry.subjectKey,
            subjectLabel: entry.subjectLabel,
            role: entry.role as "viewer" | "commenter" | "editor",
          }));
        const { sharingChanged } = resolveExistingPageSharing(
          {
            visibility: current.visibility,
            generalRole: current.generalRole,
            chapterId: current.chapterId,
            access: storedAccess,
          },
          {
            visibility: operation.page.meta.visibility,
            generalRole: operation.page.meta.generalRole,
            chapterId: operation.page.meta.chapterId,
            access: operation.page.meta.access,
          },
        );
        if (sharingChanged && !permission.canManageSharing)
          return Response.json({ error: "sharing_forbidden", id }, { status: 403 });
      }
    }
  }
  if (conflicts.length)
    return Response.json({ error: "revision_conflict", conflicts }, { status: 409 });
  return null;
}

export type ResolvedSyncPageSharing = {
  effectiveMeta: SyncPagePayload["meta"] & { updateSharing: boolean };
  resolvedSharing: ReturnType<typeof resolveExistingPageSharing>;
};

/**
 * Fold the requested sharing block against the stored row (agents often rewrite
 * front matter from the create template). Returns an error `Response` when the
 * effective visibility / role is invalid.
 */
export function resolveSyncPageSharing(
  current: PageRow | undefined,
  existingAccess: readonly AccessRow[],
  meta: SyncPagePayload["meta"],
): ResolvedSyncPageSharing | Response {
  const storedAccessForPage = current
    ? existingAccess
        .filter((entry) => entry.pageId === current.id)
        .map((entry) => ({
          subjectType: entry.subjectType as "email" | "chapter",
          subjectKey: entry.subjectKey,
          subjectLabel: entry.subjectLabel,
          role: entry.role as "viewer" | "commenter" | "editor",
        }))
    : [];
  const resolvedSharing = current
    ? resolveExistingPageSharing(
        {
          visibility: current.visibility,
          generalRole: current.generalRole,
          chapterId: current.chapterId,
          access: storedAccessForPage,
        },
        {
          visibility: meta.visibility,
          generalRole: meta.generalRole,
          chapterId: meta.chapterId,
          access: meta.access,
        },
      )
    : {
        sharing: {
          visibility: meta.visibility,
          generalRole: meta.generalRole,
          chapterId: meta.chapterId,
          access: meta.access,
        },
        sharingChanged: true,
        preserved: false,
      };
  const effectiveMeta = {
    ...meta,
    visibility: resolvedSharing.sharing.visibility,
    generalRole: resolvedSharing.sharing.generalRole,
    chapterId: resolvedSharing.sharing.chapterId,
    access: resolvedSharing.sharing.access,
    updateSharing: Boolean(current && resolvedSharing.sharingChanged),
  } as ResolvedSyncPageSharing["effectiveMeta"];
  if (!isGeneralAccess(effectiveMeta.visibility) || !isPageRole(effectiveMeta.generalRole))
    return Response.json({ error: "invalid_access" }, { status: 400 });
  return { effectiveMeta, resolvedSharing };
}

/**
 * Append every D1 statement for one upsert page (row / version / tags / access /
 * sources / attachments). Pushes into `statements`, `objectsToDelete`, and
 * `translatePageIds`; returns the attachment id map, or an error `Response`.
 */
export async function buildSyncPageWriteStatements(args: {
  db: Db;
  env: Env;
  page: SyncPagePayload;
  current: PageRow | undefined;
  id: string;
  effectiveMeta: ResolvedSyncPageSharing["effectiveMeta"];
  contentJa: string | undefined;
  contentEn: string | undefined;
  aclSourceIdsJson: string;
  resolvedSharing: ReturnType<typeof resolveExistingPageSharing>;
  expectedRevision: number | undefined;
  existingAttachments: readonly AttachmentRow[];
  identity: BearerIdentity;
  statements: D1PreparedStatement[];
  objectsToDelete: string[];
  translatePageIds: Set<string>;
}): Promise<Response | { attachmentIds: Record<string, string> }> {
  const {
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
    expectedRevision,
    existingAttachments,
    identity,
    statements,
    objectsToDelete,
    translatePageIds,
  } = args;

  if (!current) {
    const localeValues = buildNewPageLocaleValues({
      ...page,
      meta: effectiveMeta,
    });
    statements.push(
      env.DB.prepare(
        "INSERT INTO pages (id,title_ja,title_en,slug,content_ja,content_en,translation_status_ja,translation_status_en,summary_ja,summary_en,parent_id,acl_synced_with_parent,sort_order,status,page_type,page_metadata,visibility,general_role,chapter_id,origin,author_id,last_edited_by,acl_source_ids,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch(),unixepoch())",
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
        page.parentId === null ? 1 : 0,
        page.sortOrder,
        "published",
        effectiveMeta.pageType,
        effectiveMeta.pageMetadata === null ? null : JSON.stringify(effectiveMeta.pageMetadata),
        effectiveMeta.visibility,
        effectiveMeta.generalRole,
        effectiveMeta.chapterId,
        "agent",
        identity.user.id,
        identity.user.id,
        aclSourceIdsJson,
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
      { ...page, meta: effectiveMeta },
      contentJa,
      contentEn,
      identity.user.id,
      id,
      expectedRevision,
      aclSourceIdsJson,
    );
    statements.push(env.DB.prepare(update.sql).bind(...update.binds));
    // Only mark ACL drift when sharing actually changes; content-only updates
    // must not force nested pages to re-sync parent grants.
    if (resolvedSharing.sharingChanged) {
      statements.push(
        env.DB.prepare("UPDATE pages SET acl_synced_with_parent = ? WHERE id = ?").bind(
          page.parentId === null ? 1 : 0,
          id,
        ),
      );
    }
    if (jaContentChanged(current, page.ja, contentJa)) translatePageIds.add(id);
  }
  if (effectiveMeta.tags.length) {
    const known = await db
      .select({ slug: schema.tags.slug })
      .from(schema.tags)
      .where(inArray(schema.tags.slug, effectiveMeta.tags))
      .all();
    if (known.length !== new Set(effectiveMeta.tags).size)
      return Response.json({ error: "unknown_tag" }, { status: 400 });
  }
  statements.push(env.DB.prepare("DELETE FROM page_tags WHERE page_id = ?").bind(id));
  if (!current || resolvedSharing.sharingChanged) {
    statements.push(env.DB.prepare("DELETE FROM page_access WHERE page_id = ?").bind(id));
  }
  statements.push(env.DB.prepare("DELETE FROM page_sources WHERE page_id = ?").bind(id));
  for (const tag of [...new Set(effectiveMeta.tags)])
    statements.push(
      env.DB.prepare("INSERT INTO page_tags (page_id,tag_slug) VALUES (?,?)").bind(id, tag),
    );
  if (!current || resolvedSharing.sharingChanged) {
    for (const entry of effectiveMeta.access)
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
  }
  for (const source of effectiveMeta.sources)
    statements.push(
      env.DB.prepare(
        "INSERT INTO page_sources (id,page_id,url,title,source_id,created_at) VALUES (?,?,?,?,?,unixepoch())",
      ).bind(source.id ?? nanoid(), id, source.url ?? "", source.title, source.sourceId ?? null),
    );
  const attachmentIds: Record<string, string> = {};
  const requestedIds = new Set(effectiveMeta.attachments.flatMap((a) => (a.id ? [a.id] : [])));
  if (current) {
    const currentAttachments = existingAttachments.filter((attachment) => attachment.pageId === id);
    const unknownAttachment = [...requestedIds].find(
      (attachmentId) => !currentAttachments.some((attachment) => attachment.id === attachmentId),
    );
    if (unknownAttachment)
      return Response.json({ error: "unknown_attachment", id: unknownAttachment }, { status: 400 });
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
  for (const attachment of effectiveMeta.attachments) {
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
  return { attachmentIds };
}
