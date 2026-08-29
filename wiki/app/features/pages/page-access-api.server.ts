import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { requireUser } from "~/features/auth/utils.server";
import { sendPageShareEmail } from "~/features/notifications/email.server";
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
} from "~/features/pages/access.server";
import { wikiPagePath } from "~/features/pages/wiki-page-path";
import { getWikiCanonicalSlugPath } from "~/features/pages/wiki-page-path.server";
import { getDb } from "~/lib/db.server";
import {
  type PageRecord,
  asShareSubject,
  getDescendantCounts,
  invalidateCollaborationBestEffort,
  loadPage,
  markAclChanged,
  replaceAclFromParent,
  requireSharingPermissions,
} from "./page-acl-helpers.server";

/** GET /api/pages/:pageId/access — explicit shares, owner, and evaluated permissions. */
export async function loadPageAccess(
  env: Env,
  request: Request,
  pageId: string | undefined,
): Promise<Response> {
  const user = await requireUser(request, env);
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

/** POST /api/pages/:pageId/access — batch grant, grant update/remove, general-access changes. */
export async function handlePageAccessAction(
  env: Env,
  request: Request,
  pageId: string | undefined,
): Promise<Response> {
  const user = await requireUser(request, env);
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
    const pagePath =
      page.pageType === "task-list"
        ? `/tasks/${page.slug}`
        : wikiPagePath(await getWikiCanonicalSlugPath(env, page.id));
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
    const includeUnsynced = body.includeUnsynced === true;
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
        if (!child.aclSyncedWithParent && !includeUnsynced) {
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
