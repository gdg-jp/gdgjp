import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { getEffectivePagePermissions } from "~/lib/page-access.server";

// ---------------------------------------------------------------------------
// GET — list teams for a task list
// ---------------------------------------------------------------------------
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const { taskListId } = params;
  if (!taskListId) return Response.json({ error: "Missing taskListId" }, { status: 400 });

  const page = await db
    .select({
      id: schema.pages.id,
      authorId: schema.pages.authorId,
      visibility: schema.pages.visibility,
      generalRole: schema.pages.generalRole,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, taskListId))
    .get();
  if (!page) return Response.json({ error: "Task list not found" }, { status: 404 });
  const permissions = await getEffectivePagePermissions(db, page, user, identity.chapterIds);
  if (!permissions.canView) return Response.json({ error: "Forbidden" }, { status: 403 });

  const teams = await db
    .select()
    .from(schema.taskListTeams)
    .where(eq(schema.taskListTeams.taskListId, taskListId))
    .orderBy(schema.taskListTeams.sortOrder)
    .all();

  return Response.json({ teams });
}

// ---------------------------------------------------------------------------
// POST — create/update/delete teams
// ---------------------------------------------------------------------------
export async function action({ request, params, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const { taskListId } = params;
  if (!taskListId) return Response.json({ error: "Missing taskListId" }, { status: 400 });

  // Only list author, leads, admins can manage teams
  const listPage = await db
    .select({
      id: schema.pages.id,
      authorId: schema.pages.authorId,
      visibility: schema.pages.visibility,
      generalRole: schema.pages.generalRole,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, taskListId))
    .get();

  if (!listPage) return Response.json({ error: "Task list not found" }, { status: 404 });

  const canManage = (await getEffectivePagePermissions(db, listPage, user, identity.chapterIds))
    .canEdit;

  if (!canManage) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { intent, id, name, color, sortOrder } = body as {
    intent: "create" | "update" | "delete";
    id?: string;
    name?: string;
    color?: string;
    sortOrder?: number;
  };

  if (intent === "create") {
    if (!name?.trim()) return Response.json({ error: "Name is required" }, { status: 400 });

    const maxSort = await db
      .select({ max: sql<number>`coalesce(max(sort_order), -1)` })
      .from(schema.taskListTeams)
      .where(eq(schema.taskListTeams.taskListId, taskListId))
      .get();

    const teamId = nanoid();
    await db.insert(schema.taskListTeams).values({
      id: teamId,
      taskListId,
      name,
      color: color ?? "#6b7280",
      sortOrder: (maxSort?.max ?? -1) + 1,
    });

    return Response.json({ ok: true, id: teamId });
  }

  if (intent === "update") {
    if (!id) return Response.json({ error: "Missing team id" }, { status: 400 });
    if (name !== undefined && !name.trim()) {
      return Response.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (color !== undefined) updates.color = color;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    await db.update(schema.taskListTeams).set(updates).where(eq(schema.taskListTeams.id, id));
    return Response.json({ ok: true });
  }

  if (intent === "delete") {
    if (!id) return Response.json({ error: "Missing team id" }, { status: 400 });
    await db.delete(schema.taskListTeams).where(eq(schema.taskListTeams.id, id));
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Invalid intent" }, { status: 400 });
}
