import { eq } from "drizzle-orm";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import { createAuth } from "~/lib/auth.server";
import { getDb } from "~/lib/db.server";
import { sendPageShareEmail } from "~/lib/email.server";
import {
  type GeneralAccess,
  type PageRole,
  type ShareSubject,
  getEffectivePagePermissions,
  getPageAccessList,
  isGeneralAccess,
  isPageRole,
  normalizeEmail,
  removePageAccess,
  updatePageAccessRole,
  upsertPageAccess,
} from "~/lib/page-access.server";

type PageRecord = {
  id: string;
  slug: string;
  titleJa: string;
  pageType: string | null;
  parentId: string | null;
  aclSyncedWithParent: boolean;
  authorId: string;
  visibility: string;
  generalRole: string;
};

async function getChapterIds(
  request: Request,
  env: Env,
): Promise<{ chapters: Array<{ chapterId: string; role: string }>; unavailable: boolean }> {
  try {
    const claims = await createAuth(env).getFreshClaims(request);
    return {
      chapters: claims.chapters.map((chapter) => ({
        chapterId: String(chapter.chapterId),
        role: chapter.role,
      })),
      unavailable: false,
    };
  } catch {
    // A stale/failed IdP lookup must never accidentally retain Chapter access.
    return { chapters: [], unavailable: true };
  }
}

async function loadPage(db: ReturnType<typeof getDb>, pageId: string): Promise<PageRecord | null> {
  return (
    (await db
      .select({
        id: schema.pages.id,
        slug: schema.pages.slug,
        titleJa: schema.pages.titleJa,
        pageType: schema.pages.pageType,
        parentId: schema.pages.parentId,
        aclSyncedWithParent: schema.pages.aclSyncedWithParent,
        authorId: schema.pages.authorId,
        visibility: schema.pages.visibility,
        generalRole: schema.pages.generalRole,
      })
      .from(schema.pages)
      .where(eq(schema.pages.id, pageId))
      .get()) ?? null
  );
}

type DescendantCounts = { descendantCount: number; syncedDescendantCount: number };

async function getDescendantCounts(env: Env, pageId: string): Promise<DescendantCounts> {
  const row = (await env.DB.prepare(
    `WITH RECURSIVE descendants(id, acl_synced_with_parent) AS (
       SELECT id, acl_synced_with_parent FROM pages WHERE parent_id = ?
       UNION ALL
       SELECT page.id, page.acl_synced_with_parent
       FROM pages AS page JOIN descendants ON page.parent_id = descendants.id
     ), synced_descendants(id) AS (
       SELECT id FROM pages WHERE parent_id = ? AND acl_synced_with_parent = 1
       UNION ALL
       SELECT page.id FROM pages AS page
       JOIN synced_descendants ON page.parent_id = synced_descendants.id
       WHERE page.acl_synced_with_parent = 1
     )
     SELECT
       (SELECT COUNT(*) FROM descendants) AS descendantCount,
       (SELECT COUNT(*) FROM synced_descendants) AS syncedDescendantCount`,
  )
    .bind(pageId, pageId)
    .first()) as { descendantCount: number; syncedDescendantCount: number } | null;
  return {
    descendantCount: Number(row?.descendantCount ?? 0),
    syncedDescendantCount: Number(row?.syncedDescendantCount ?? 0),
  };
}

async function replaceAclFromParent(
  env: Env,
  sourcePageId: string,
  targetPage: PageRecord,
  grantedBy: string,
) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM page_access WHERE page_id = ?").bind(targetPage.id),
    env.DB.prepare(
      `INSERT INTO page_access (
         id, page_id, subject_type, subject_key, subject_label, user_id, role, granted_by,
         created_at, updated_at
       )
       SELECT lower(hex(randomblob(16))), ?, subject_type, subject_key, subject_label, user_id,
              role, ?, unixepoch(), unixepoch()
       FROM page_access WHERE page_id = ?`,
    ).bind(targetPage.id, grantedBy, sourcePageId),
    env.DB.prepare(
      `UPDATE pages
       SET visibility = (SELECT visibility FROM pages WHERE id = ?),
           general_role = (SELECT general_role FROM pages WHERE id = ?),
           acl_synced_with_parent = 1,
           updated_at = unixepoch()
       WHERE id = ?`,
    ).bind(sourcePageId, sourcePageId, targetPage.id),
  ]);
}

async function markAclChanged(db: ReturnType<typeof getDb>, page: PageRecord) {
  await db
    .update(schema.pages)
    .set({ aclSyncedWithParent: page.parentId === null, updatedAt: new Date() })
    .where(eq(schema.pages.id, page.id));
}

function asShareSubject(value: unknown): ShareSubject | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const subjectType = raw.subjectType ?? raw.type;
  const subjectKey = raw.subjectKey ?? raw.key ?? raw.email ?? raw.id;
  const subjectLabel = raw.subjectLabel ?? raw.label ?? raw.name ?? raw.email;
  if ((subjectType !== "email" && subjectType !== "chapter") || typeof subjectKey !== "string") {
    return null;
  }
  if (typeof subjectLabel !== "string" || !subjectLabel.trim()) return null;
  if (subjectType === "email" && (!subjectKey.includes("@") || subjectKey.length > 320))
    return null;
  if (subjectKey.length > 320 || subjectLabel.length > 320) return null;
  return {
    subjectType,
    subjectKey: subjectType === "email" ? normalizeEmail(subjectKey) : subjectKey,
    subjectLabel: subjectLabel.trim(),
    userId: typeof raw.userId === "string" ? raw.userId : null,
  };
}

async function invalidateCollaboration(env: Env, slug: string): Promise<void> {
  const id = env.COLLAB_DO.idFromName(slug);
  await env.COLLAB_DO.get(id).fetch("https://collab.internal/access-changed", { method: "POST" });
}

async function invalidateCollaborationBestEffort(env: Env, slug: string): Promise<void> {
  try {
    await invalidateCollaboration(env, slug);
  } catch (error) {
    console.error("Failed to disconnect collaborative editing sessions", error);
  }
}

async function requireSharingPermissions(
  db: ReturnType<typeof getDb>,
  page: PageRecord,
  request: Request,
  env: Env,
  user: Awaited<ReturnType<typeof requireUser>>,
) {
  const claims = await getChapterIds(request, env);
  const permissions = await getEffectivePagePermissions(db, page, user, claims.chapters);
  return { permissions, chapters: claims.chapters, claimsUnavailable: claims.unavailable };
}

// GET — explicit shares, owner and the caller's evaluated permissions.
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const pageId = params.pageId;
  if (!pageId) return new Response("Missing pageId", { status: 400 });

  const db = getDb(env);
  const page = await loadPage(db, pageId);
  if (!page) return new Response("Not Found", { status: 404 });
  const { permissions, claimsUnavailable } = await requireSharingPermissions(
    db,
    page,
    request,
    env,
    user,
  );
  if (!permissions.canView) return new Response("Forbidden", { status: 403 });

  const [accessList, author, descendantCounts] = await Promise.all([
    getPageAccessList(db, pageId),
    db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        image: schema.user.image,
      })
      .from(schema.user)
      .where(eq(schema.user.id, page.authorId))
      .get(),
    getDescendantCounts(env, pageId),
  ]);
  return Response.json({
    accessList,
    owner: author
      ? {
          ...author,
          role: "owner",
          subjectType: "email",
          subjectKey: author.email,
          subjectLabel: author.name,
        }
      : null,
    permissions,
    myRole: permissions.role,
    canManageSharing: permissions.canManageSharing,
    generalAccess: page.visibility as GeneralAccess,
    visibility: page.visibility as GeneralAccess,
    generalRole: page.generalRole as PageRole,
    parentId: page.parentId,
    aclSyncedWithParent: page.aclSyncedWithParent,
    ...descendantCounts,
    claimsUnavailable,
  });
}

// POST — batch grant, one-grant update/remove, and general-access changes.
export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const pageId = params.pageId;
  if (!pageId) return new Response("Missing pageId", { status: 400 });
  const db = getDb(env);
  const page = await loadPage(db, pageId);
  if (!page) return new Response("Not Found", { status: 404 });

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const intent = body.intent;
  const { permissions, chapters } = await requireSharingPermissions(db, page, request, env, user);
  if (!permissions.canManageSharing) return new Response("Forbidden", { status: 403 });

  if (intent === "batchGrant" || intent === "add") {
    const rawTargets = intent === "add" ? [body] : (body.targets ?? body.subjects);
    if (!Array.isArray(rawTargets) || rawTargets.length === 0 || rawTargets.length > 50) {
      return Response.json({ error: "invalid_targets" }, { status: 400 });
    }
    const role = body.role ?? body.pageRole;
    if (!isPageRole(role)) return Response.json({ error: "invalid_role" }, { status: 400 });
    const targets = rawTargets.map(asShareSubject);
    if (targets.some((target) => !target))
      return Response.json({ error: "invalid_targets" }, { status: 400 });
    const unique = new Map<string, ShareSubject>();
    for (const target of targets as ShareSubject[]) {
      unique.set(`${target.subjectType}:${target.subjectKey}`, target);
    }

    // Persist all grants before attempting notifications. A failed email never
    // rolls back a permission change.
    await Promise.all(
      [...unique.values()].map((target) =>
        upsertPageAccess(db, { ...target, pageId, role, grantedBy: user.id }),
      ),
    );
    await markAclChanged(db, page);
    await invalidateCollaborationBestEffort(env, page.slug);

    const notify = body.notify === true;
    const message = typeof body.message === "string" ? body.message.slice(0, 4000) : undefined;
    const emailTargets = notify
      ? [...unique.values()].filter((target) => target.subjectType === "email")
      : [];
    const pagePath = page.pageType === "task-list" ? `/tasks/${page.slug}` : `/wiki/${page.slug}`;
    const pageUrl = new URL(pagePath, env.APP_URL).toString();
    const deliveries = await Promise.allSettled(
      emailTargets.map((target) =>
        sendPageShareEmail(env, {
          to: target.subjectKey,
          pageTitle: page.titleJa,
          pageUrl,
          role,
          sharedByName: user.name,
          message,
        }),
      ),
    );
    const notificationFailures = deliveries.filter(
      (delivery) => delivery.status === "rejected",
    ).length;
    return Response.json({
      ok: true,
      notificationFailures,
      ...(notificationFailures > 0
        ? {
            warning: `Sharing completed, but ${notificationFailures} email notification(s) failed.`,
          }
        : {}),
    });
  }

  if (intent === "update") {
    const accessId = body.accessId;
    const role = body.role ?? body.pageRole;
    if (typeof accessId !== "string" || !isPageRole(role)) {
      return Response.json({ error: "invalid_params" }, { status: 400 });
    }
    const ok = await updatePageAccessRole(db, accessId, pageId, role, user.id);
    if (ok) {
      await markAclChanged(db, page);
      await invalidateCollaborationBestEffort(env, page.slug);
    }
    return ok ? Response.json({ ok: true }) : new Response("Not Found", { status: 404 });
  }

  if (intent === "remove") {
    const accessId = body.accessId;
    if (typeof accessId !== "string")
      return Response.json({ error: "invalid_params" }, { status: 400 });
    const result = await removePageAccess(db, accessId, pageId);
    if (result.ok) {
      await markAclChanged(db, page);
      await invalidateCollaborationBestEffort(env, page.slug);
    }
    return result.ok ? Response.json({ ok: true }) : new Response("Not Found", { status: 404 });
  }

  if (intent === "transfer") {
    // Ownership is implicit via pages.authorId, so only the current owner may
    // transfer it. Editors (and admins acting as admins) cannot replace one.
    if (user.id !== page.authorId) return new Response("Forbidden", { status: 403 });
    const accessId = body.accessId;
    if (typeof accessId !== "string") {
      return Response.json({ error: "invalid_params" }, { status: 400 });
    }

    const target = await db
      .select({
        id: schema.pageAccess.id,
        pageId: schema.pageAccess.pageId,
        subjectType: schema.pageAccess.subjectType,
        subjectKey: schema.pageAccess.subjectKey,
        userId: schema.pageAccess.userId,
      })
      .from(schema.pageAccess)
      .where(eq(schema.pageAccess.id, accessId))
      .get();
    if (!target || target.pageId !== pageId || target.subjectType !== "email") {
      return Response.json({ error: "invalid_transfer_target" }, { status: 400 });
    }

    const newOwner = target.userId
      ? await db
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(eq(schema.user.id, target.userId))
          .get()
      : await db
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(eq(schema.user.email, normalizeEmail(target.subjectKey)))
          .get();
    if (!newOwner || newOwner.id === page.authorId) {
      return Response.json({ error: "invalid_transfer_target" }, { status: 400 });
    }

    const previousOwner = await db
      .select({ email: schema.user.email, name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, page.authorId))
      .get();
    if (!previousOwner) return new Response("Not Found", { status: 404 });

    // The former owner remains an editor. The ownership switch and removal of
    // the new owner's redundant explicit grant happen in one D1 batch.
    await upsertPageAccess(db, {
      pageId,
      subjectType: "email",
      subjectKey: previousOwner.email,
      subjectLabel: previousOwner.name,
      userId: page.authorId,
      role: "editor",
      grantedBy: user.id,
    });
    await db.batch([
      db
        .update(schema.pages)
        .set({
          authorId: newOwner.id,
          aclSyncedWithParent: page.parentId === null,
          updatedAt: new Date(),
        })
        .where(eq(schema.pages.id, pageId)),
      db.delete(schema.pageAccess).where(eq(schema.pageAccess.id, accessId)),
    ]);
    await invalidateCollaborationBestEffort(env, page.slug);
    return Response.json({ ok: true });
  }

  if (intent === "setGeneralAccess" || intent === "setVisibility") {
    const visibility = body.visibility ?? body.generalAccess;
    const generalRole = body.generalRole ?? body.role;
    if (!isGeneralAccess(visibility))
      return Response.json({ error: "invalid_visibility" }, { status: 400 });
    if (visibility !== "restricted" && !isPageRole(generalRole)) {
      return Response.json({ error: "invalid_role" }, { status: 400 });
    }
    const nextGeneralRole: PageRole =
      visibility === "restricted" ? "viewer" : isPageRole(generalRole) ? generalRole : "viewer";
    await db
      .update(schema.pages)
      .set({
        visibility,
        generalRole: nextGeneralRole,
        aclSyncedWithParent: page.parentId === null,
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, pageId));
    await invalidateCollaborationBestEffort(env, page.slug);
    return Response.json({ ok: true });
  }

  if (intent === "syncWithParent") {
    if (!page.parentId) return Response.json({ error: "no_parent" }, { status: 400 });
    const parent = await loadPage(db, page.parentId);
    if (!parent) return Response.json({ error: "parent_not_found" }, { status: 404 });
    await replaceAclFromParent(env, parent.id, page, user.id);
    await invalidateCollaborationBestEffort(env, page.slug);
    return Response.json({ ok: true });
  }

  if (intent === "syncDescendants") {
    type ChildRow = PageRecord;
    const queue: Array<{ id: string }> = [{ id: page.id }];
    let updatedCount = 0;
    let unsyncedSkippedCount = 0;
    const permissionSkipped: Array<{ id: string; title: string }> = [];

    while (queue.length) {
      const parent = queue.shift() as { id: string };
      const children = (await env.DB.prepare(
        `SELECT id, slug, title_ja AS titleJa, page_type AS pageType, parent_id AS parentId,
                acl_synced_with_parent AS aclSyncedWithParent, author_id AS authorId,
                visibility, general_role AS generalRole
         FROM pages WHERE parent_id = ? ORDER BY sort_order, id`,
      )
        .bind(parent.id)
        .all()) as { results: ChildRow[] };
      for (const child of children.results) {
        if (!child.aclSyncedWithParent) {
          unsyncedSkippedCount += 1;
          continue;
        }
        const childPermissions = await getEffectivePagePermissions(db, child, user, chapters);
        if (!childPermissions.canManageSharing) {
          permissionSkipped.push({ id: child.id, title: child.titleJa });
          continue;
        }
        await replaceAclFromParent(env, parent.id, child, user.id);
        await invalidateCollaborationBestEffort(env, child.slug);
        updatedCount += 1;
        queue.push({ id: child.id });
      }
    }
    return Response.json({
      ok: true,
      updatedCount,
      unsyncedSkippedCount,
      permissionSkippedCount: permissionSkipped.length,
      permissionSkipped,
    });
  }

  return new Response("Unknown intent", { status: 400 });
}
