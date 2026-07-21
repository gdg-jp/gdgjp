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
  authorId: string;
  visibility: string;
  generalRole: string;
};

async function getChapterIds(
  request: Request,
  env: Env,
): Promise<{ ids: number[]; unavailable: boolean }> {
  try {
    const claims = await createAuth(env).getFreshClaims(request);
    return { ids: claims.chapters.map((chapter) => chapter.chapterId), unavailable: false };
  } catch {
    // A stale/failed IdP lookup must never accidentally retain Chapter access.
    return { ids: [], unavailable: true };
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
        authorId: schema.pages.authorId,
        visibility: schema.pages.visibility,
        generalRole: schema.pages.generalRole,
      })
      .from(schema.pages)
      .where(eq(schema.pages.id, pageId))
      .get()) ?? null
  );
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
  const permissions = await getEffectivePagePermissions(db, page, user, claims.ids);
  return { permissions, claimsUnavailable: claims.unavailable };
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

  const [accessList, author] = await Promise.all([
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
  const { permissions } = await requireSharingPermissions(db, page, request, env, user);
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
    if (ok) await invalidateCollaborationBestEffort(env, page.slug);
    return ok ? Response.json({ ok: true }) : new Response("Not Found", { status: 404 });
  }

  if (intent === "remove") {
    const accessId = body.accessId;
    if (typeof accessId !== "string")
      return Response.json({ error: "invalid_params" }, { status: 400 });
    const result = await removePageAccess(db, accessId, pageId);
    if (result.ok) await invalidateCollaborationBestEffort(env, page.slug);
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
        .set({ authorId: newOwner.id, updatedAt: new Date() })
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
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, pageId));
    await invalidateCollaborationBestEffort(env, page.slug);
    return Response.json({ ok: true });
  }

  return new Response("Unknown intent", { status: 400 });
}
