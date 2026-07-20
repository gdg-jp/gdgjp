import { eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { getEffectivePagePermissions } from "~/lib/page-access.server";

// ---------------------------------------------------------------------------
// GET — list tasks for a task list
// ---------------------------------------------------------------------------
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const { taskListId } = params;
  if (!taskListId) return Response.json({ error: "Missing taskListId" }, { status: 400 });

  // Task lists are pages (pageType="task-list"); apply the same visibility
  // rules used by the /tasks/:slug page route.
  const page = await db
    .select({
      id: schema.pages.id,
      visibility: schema.pages.visibility,
      generalRole: schema.pages.generalRole,
      chapterId: schema.pages.chapterId,
      authorId: schema.pages.authorId,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, taskListId))
    .get();

  if (!page) return Response.json({ error: "Task list not found" }, { status: 404 });
  if (!(await getEffectivePagePermissions(db, page, user, identity.chapterIds)).canView) {
    return new Response("Forbidden", { status: 403 });
  }

  const tasks = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.taskListId, taskListId))
    .orderBy(schema.tasks.sortOrder)
    .all();

  const teams = await db
    .select()
    .from(schema.taskListTeams)
    .where(eq(schema.taskListTeams.taskListId, taskListId))
    .orderBy(schema.taskListTeams.sortOrder)
    .all();

  const taskIds = tasks.map((t) => t.id);
  const deps =
    taskIds.length > 0
      ? await db
          .select()
          .from(schema.taskDependencies)
          .where(inArray(schema.taskDependencies.taskId, taskIds))
          .all()
      : [];

  return Response.json({ tasks, teams, deps });
}

// ---------------------------------------------------------------------------
// POST — create a new task
// ---------------------------------------------------------------------------
export async function action({ request, params, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const { taskListId } = params;
  if (!taskListId) return Response.json({ error: "Missing taskListId" }, { status: 400 });

  // Creating tasks mutates the task list (increments nextTaskNumber and
  // appends to it). Only the page author or an admin may do that — same
  // gate as /tasks/:slug intent="updateSettings".
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
  if (!(await getEffectivePagePermissions(db, page, user, identity.chapterIds)).canEdit) {
    return new Response("Forbidden", { status: 403 });
  }

  const body = await request.json();
  const {
    title,
    description,
    status,
    type,
    dueDate,
    assigneeId,
    assigneeName,
    teamId,
    dependencies,
  } = body as {
    title?: string;
    description?: string;
    status?: string;
    type?: string;
    dueDate?: string;
    assigneeId?: string;
    assigneeName?: string;
    teamId?: string;
    dependencies?: string[];
  };

  if (!title) {
    return Response.json({ error: "Title is required" }, { status: 400 });
  }

  const taskId = nanoid();
  const depIds = Array.isArray(dependencies) ? dependencies : [];

  // Atomically increment nextTaskNumber and get both the assigned number and max sort order
  const [updated] = await db
    .update(schema.taskLists)
    .set({ nextTaskNumber: sql`${schema.taskLists.nextTaskNumber} + 1` })
    .where(eq(schema.taskLists.pageId, taskListId))
    .returning({ nextTaskNumber: schema.taskLists.nextTaskNumber });

  if (!updated) {
    return Response.json({ error: "Task list not found" }, { status: 404 });
  }

  const taskNumber = updated.nextTaskNumber - 1;

  const maxSort = await db
    .select({ max: sql<number>`coalesce(max(sort_order), -1)` })
    .from(schema.tasks)
    .where(eq(schema.tasks.taskListId, taskListId))
    .get();

  await db.batch([
    db.insert(schema.tasks).values({
      id: taskId,
      taskListId,
      number: taskNumber,
      title,
      description: description ?? "",
      status: status ?? "todo",
      type: type ?? "task",
      dueDate: dueDate ?? null,
      assigneeId: assigneeName ? null : (assigneeId ?? null),
      assigneeName: assigneeName ?? null,
      teamId: teamId ?? null,
      createdBy: user.id,
      sortOrder: (maxSort?.max ?? -1) + 1,
    }),
    ...depIds.map((depId) =>
      db.insert(schema.taskDependencies).values({ taskId, dependsOnTaskId: depId }),
    ),
  ]);

  return Response.json({ ok: true, id: taskId, number: taskNumber });
}
