import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/features/auth/utils.server";
import { getEffectivePagePermissions } from "~/features/pages/access.server";
import { archivePageAndDescendants } from "~/features/pages/archive.server";
import { getDb } from "~/lib/db.server";

/** Resolved shape of the `/tasks/:slug` loader data (used by `TaskListView`). */
export type TaskDetailData = Awaited<ReturnType<typeof loadTaskDetail>>;

/** Data assembly behind the `/tasks/:slug` loader. */
export async function loadTaskDetail(request: Request, env: Env, slug: string | undefined) {
  const identity = await getAccessIdentity(request, env);
  const user = identity.user;
  const db = getDb(env);

  if (!slug) throw new Response("Not found", { status: 404 });

  const page = await db
    .select()
    .from(schema.pages)
    .where(and(eq(schema.pages.slug, slug), eq(schema.pages.pageType, "task-list")))
    .get();

  if (!page) throw new Response("Not found", { status: 404 });

  const permissions = await getEffectivePagePermissions(db, page, user, identity.chapters);
  if (!permissions.canView) {
    if (!identity.claimsAvailable && page.visibility === "restricted") {
      throw new Response("Access service temporarily unavailable", { status: 503 });
    }
    throw new Response("Forbidden", { status: 403 });
  }

  const taskListMeta = await db
    .select()
    .from(schema.taskLists)
    .where(eq(schema.taskLists.pageId, page.id))
    .get();

  if (!taskListMeta) throw new Response("Not found", { status: 404 });

  const tasks = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.taskListId, page.id))
    .orderBy(schema.tasks.sortOrder)
    .all();

  const teams = await db
    .select()
    .from(schema.taskListTeams)
    .where(eq(schema.taskListTeams.taskListId, page.id))
    .orderBy(schema.taskListTeams.sortOrder)
    .all();

  // Get dependencies for all tasks in this list
  const taskIds = tasks.map((t) => t.id);
  const deps =
    taskIds.length > 0
      ? await db
          .select()
          .from(schema.taskDependencies)
          .where(inArray(schema.taskDependencies.taskId, taskIds))
          .all()
      : [];

  // Build dependency map
  const depMap = new Map<string, string[]>();
  for (const d of deps) {
    const list = depMap.get(d.taskId) || [];
    list.push(d.dependsOnTaskId);
    depMap.set(d.taskId, list);
  }

  // Assignee list: pre-SSO this scoped to the task list's chapter members.
  // Wiki no longer stores per-user chapter, so all users are candidates;
  // re-scope once chapter membership is read from IdP claims.
  const members = permissions.canEdit
    ? await db
        .select({ id: schema.user.id, name: schema.user.name, image: schema.user.image })
        .from(schema.user)
        .all()
    : [];

  const canManage = permissions.canEdit;

  const fav = user
    ? await db
        .select()
        .from(schema.pageFavorites)
        .where(
          and(eq(schema.pageFavorites.userId, user.id), eq(schema.pageFavorites.pageId, page.id)),
        )
        .get()
    : undefined;

  return {
    page,
    tasks: tasks.map((t) => ({
      ...t,
      dependencies: depMap.get(t.id) || [],
    })),
    teams,
    members,
    taskListId: page.id,
    canManage,
    canChangeVisibility: permissions.canManageSharing,
    canManageAccess: permissions.canManageSharing,
    userId: user?.id ?? null,
    isAuthenticated: !!user,
    nextTaskNumber: taskListMeta.nextTaskNumber,
    isStarred: !!fav,
    canArchive: !!user && (user.isAdmin || user.id === page.authorId),
  };
}

/** Favorite toggle / archive / settings update behind the `/tasks/:slug` action. */
export async function handleTaskDetailAction(request: Request, env: Env, slug: string | undefined) {
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  if (!slug) throw new Response("Not found", { status: 404 });

  const page = await db
    .select()
    .from(schema.pages)
    .where(and(eq(schema.pages.slug, slug), eq(schema.pages.pageType, "task-list")))
    .get();

  if (!page) throw new Response("Not found", { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "toggleFavorite") {
    const permissions = await getEffectivePagePermissions(db, page, user, identity.chapters);
    if (!permissions.canView) throw new Response("Forbidden", { status: 403 });

    const existing = await db
      .select()
      .from(schema.pageFavorites)
      .where(
        and(eq(schema.pageFavorites.userId, user.id), eq(schema.pageFavorites.pageId, page.id)),
      )
      .get();

    if (existing) {
      await db
        .delete(schema.pageFavorites)
        .where(
          and(eq(schema.pageFavorites.userId, user.id), eq(schema.pageFavorites.pageId, page.id)),
        );
      return { ok: true, starred: false };
    }
    await db.insert(schema.pageFavorites).values({ userId: user.id, pageId: page.id });
    return { ok: true, starred: true };
  }

  if (intent === "archivePage") {
    const canArchive = user.isAdmin || user.id === page.authorId;
    if (!canArchive) throw new Response("Forbidden", { status: 403 });
    await archivePageAndDescendants(env, db, page.id);
    return redirect("/");
  }

  const permissions = await getEffectivePagePermissions(db, page, user, identity.chapters);
  const canManage = permissions.canEdit;

  if (!canManage) throw new Response("Forbidden", { status: 403 });

  if (intent === "updateSettings") {
    const titleJa = (formData.get("titleJa") as string) ?? page.titleJa;
    const titleEn = (formData.get("titleEn") as string) ?? page.titleEn;

    await db
      .update(schema.pages)
      .set({ titleJa, titleEn, updatedAt: new Date() })
      .where(eq(schema.pages.id, page.id));

    return { ok: true };
  }

  throw new Response("Bad request", { status: 400 });
}
