import { eq } from "drizzle-orm";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import type { PageRole } from "~/lib/page-access.server";
import {
  canUserGrantRole,
  canUserManageAccess,
  getPageAccessList,
  getUserPageRole,
  insertPageOwner,
  removePageAccess,
  upsertPageAccess,
} from "~/lib/page-access.server";
import { canUserChangeVisibility } from "~/lib/page-visibility.server";

const VALID_ROLES: PageRole[] = ["owner", "editor", "viewer"];
const VALID_VISIBILITY = ["public", "private_to_chapter", "private_to_lead", "restricted"] as const;

// ---------------------------------------------------------------------------
// Loader (GET) — returns access list + caller's page role
// ---------------------------------------------------------------------------

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const sessionUser = await requireUser(request, env);
  const db = getDb(env);
  const { pageId } = params;

  if (!pageId) return new Response("Missing pageId", { status: 400 });

  const page = await db
    .select({
      id: schema.pages.id,
      authorId: schema.pages.authorId,
      chapterId: schema.pages.chapterId,
      visibility: schema.pages.visibility,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .get();

  if (!page) return new Response("Not Found", { status: 404 });

  const canManage = await canUserManageAccess(db, pageId, sessionUser, page.authorId);
  if (!canManage) return new Response("Forbidden", { status: 403 });

  const [accessList, dbRole] = await Promise.all([
    getPageAccessList(db, pageId),
    getUserPageRole(db, pageId, sessionUser.id, sessionUser.email),
  ]);

  // Admins and the page author are implicitly owners even without a page_access record
  const myRole: PageRole =
    dbRole ?? (sessionUser.isAdmin || sessionUser.id === page.authorId ? "owner" : "viewer");

  return Response.json({
    accessList,
    myRole,
    canChangeVisibility: canUserChangeVisibility(sessionUser, page),
    visibility: page.visibility,
  });
}

// ---------------------------------------------------------------------------
// Action (POST) — add / update / remove / setVisibility
// ---------------------------------------------------------------------------

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const sessionUser = await requireUser(request, env);
  const db = getDb(env);
  const { pageId } = params;

  if (!pageId) return new Response("Missing pageId", { status: 400 });

  const page = await db
    .select({
      id: schema.pages.id,
      authorId: schema.pages.authorId,
      chapterId: schema.pages.chapterId,
      visibility: schema.pages.visibility,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .get();

  if (!page) return new Response("Not Found", { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { intent } = body as Record<string, unknown>;

  // -------------------------------------------------------------------------
  // add
  // -------------------------------------------------------------------------
  if (intent === "add") {
    const canManage = await canUserManageAccess(db, pageId, sessionUser, page.authorId);
    if (!canManage) return new Response("Forbidden", { status: 403 });

    const { email, pageRole } = body as { email?: string; pageRole?: string };
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return Response.json({ error: "invalid_email" }, { status: 400 });
    }
    if (!pageRole || !VALID_ROLES.includes(pageRole as PageRole)) {
      return Response.json({ error: "invalid_role" }, { status: 400 });
    }

    const dbCallerRole = await getUserPageRole(db, pageId, sessionUser.id, sessionUser.email);
    const callerRole: PageRole =
      dbCallerRole ??
      (sessionUser.isAdmin || sessionUser.id === page.authorId ? "owner" : "viewer");

    if (!canUserGrantRole(callerRole, sessionUser.isAdmin, pageRole as PageRole)) {
      return Response.json({ error: "permission" }, { status: 403 });
    }

    // Look up user by email
    const targetUser = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email))
      .get();

    await upsertPageAccess(db, {
      pageId,
      email,
      pageRole: pageRole as PageRole,
      grantedBy: sessionUser.id,
      userId: targetUser?.id ?? null,
    });

    // The page_access record itself carries the email, so unknown emails are
    // tracked as pending entries linked at first sign-in by getUserPageRole.
    // (Pre-SSO this also issued a wiki invitation row; accounts owns invites now.)

    return Response.json({ ok: true });
  }

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------
  if (intent === "update") {
    const canManage = await canUserManageAccess(db, pageId, sessionUser, page.authorId);
    if (!canManage) return new Response("Forbidden", { status: 403 });

    const { accessId, pageRole } = body as { accessId?: string; pageRole?: string };
    if (!accessId || !pageRole || !VALID_ROLES.includes(pageRole as PageRole)) {
      return new Response("Invalid params", { status: 400 });
    }

    const dbCallerRole = await getUserPageRole(db, pageId, sessionUser.id, sessionUser.email);
    const callerRole: PageRole =
      dbCallerRole ??
      (sessionUser.isAdmin || sessionUser.id === page.authorId ? "owner" : "viewer");

    if (!canUserGrantRole(callerRole, sessionUser.isAdmin, pageRole as PageRole)) {
      return Response.json({ error: "permission" }, { status: 403 });
    }

    const target = await db
      .select({ email: schema.pageAccess.email })
      .from(schema.pageAccess)
      .where(eq(schema.pageAccess.id, accessId))
      .get();

    if (!target) return new Response("Not Found", { status: 404 });

    await upsertPageAccess(db, {
      pageId,
      email: target.email,
      pageRole: pageRole as PageRole,
      grantedBy: sessionUser.id,
    });

    return Response.json({ ok: true });
  }

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------
  if (intent === "remove") {
    const canManage = await canUserManageAccess(db, pageId, sessionUser, page.authorId);
    if (!canManage) return new Response("Forbidden", { status: 403 });

    const { accessId } = body as { accessId?: string };
    if (!accessId) return new Response("Missing accessId", { status: 400 });

    const result = await removePageAccess(db, accessId, pageId);
    if (!result.ok) {
      return Response.json({ error: result.error ?? "unknown" }, { status: 400 });
    }

    return Response.json({ ok: true });
  }

  // -------------------------------------------------------------------------
  // setVisibility
  // -------------------------------------------------------------------------
  if (intent === "setVisibility") {
    if (!canUserChangeVisibility(sessionUser, page)) {
      return new Response("Forbidden", { status: 403 });
    }

    const { visibility } = body as { visibility?: string };
    if (
      !visibility ||
      !VALID_VISIBILITY.includes(visibility as (typeof VALID_VISIBILITY)[number])
    ) {
      return new Response("Invalid visibility", { status: 400 });
    }

    // Pre-SSO this auto-assigned chapterId from the caller's chapter membership.
    // Wiki no longer tracks per-user chapter locally; if the page lacks a
    // chapterId already, chapter-scoped visibility falls through to the new
    // page-visibility rules (admin/author only). Setting chapter-scoped
    // visibility on a page with no chapterId is now a no-op for non-admins.
    const chapterId = page.chapterId;

    // Safety: when switching to "restricted", ensure the page author is an owner
    if (visibility === "restricted") {
      const authorUser = await db
        .select({ id: schema.user.id, email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.id, page.authorId))
        .get();

      if (authorUser) {
        await insertPageOwner(db, pageId, authorUser.id, authorUser.email);
      }
    }

    await db
      .update(schema.pages)
      .set({ visibility, chapterId, updatedAt: new Date() })
      .where(eq(schema.pages.id, pageId));

    return Response.json({ ok: true });
  }

  return new Response("Unknown intent", { status: 400 });
}
