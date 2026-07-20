import { and, eq, inArray } from "drizzle-orm";
import type { ActionFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { getEffectivePagePermissions } from "~/lib/page-access.server";

export async function action({ request, params, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const { taskListId, taskId } = params;
  if (!taskListId || !taskId) {
    return Response.json({ error: "Missing params" }, { status: 400 });
  }

  const task = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.taskListId, taskListId)))
    .get();

  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

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

  if (!listPage) {
    return Response.json({ error: "Task list not found" }, { status: 404 });
  }

  if (!(await getEffectivePagePermissions(db, listPage, user, identity.chapterIds)).canEdit) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // -------------------------------------------------------------------------
  // PATCH — update a task
  // -------------------------------------------------------------------------
  if (request.method === "PATCH") {
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
      dueDate?: string | null;
      assigneeId?: string | null;
      assigneeName?: string | null;
      teamId?: string | null;
      dependencies?: string[];
    };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (type !== undefined) updates.type = type;
    if (dueDate !== undefined) updates.dueDate = dueDate;
    if (assigneeId !== undefined) {
      updates.assigneeId = assigneeId;
      updates.assigneeName = null;
    } else if (assigneeName !== undefined) {
      updates.assigneeName = assigneeName;
      updates.assigneeId = null;
    }
    if (teamId !== undefined) updates.teamId = teamId;

    // Validate and check dependencies before any writes
    if (dependencies !== undefined) {
      // Ensure all depIds belong to the same taskListId
      if (dependencies.length > 0) {
        const depTasks = await db
          .select({ id: schema.tasks.id })
          .from(schema.tasks)
          .where(
            and(inArray(schema.tasks.id, dependencies), eq(schema.tasks.taskListId, taskListId)),
          )
          .all();

        if (depTasks.length !== dependencies.length) {
          return Response.json(
            { error: "Invalid dependency: task not in same list" },
            { status: 400 },
          );
        }
      }

      // Cycle detection: BFS from each dependency to ensure taskId isn't reachable
      const allDeps = await db.select().from(schema.taskDependencies).all();
      const graph = new Map<string, string[]>();
      for (const d of allDeps) {
        if (d.taskId === taskId) continue; // skip current task's old deps
        const list = graph.get(d.taskId) || [];
        list.push(d.dependsOnTaskId);
        graph.set(d.taskId, list);
      }
      // Add proposed dependencies
      for (const depId of dependencies) {
        const list = graph.get(taskId) || [];
        list.push(depId);
        graph.set(taskId, list);
      }

      // Check for cycles using BFS from taskId
      const visited = new Set<string>();
      const queue = [...dependencies];
      let hasCycle = false;
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) continue;
        if (current === taskId) {
          hasCycle = true;
          break;
        }
        if (visited.has(current)) continue;
        visited.add(current);
        const next = graph.get(current) || [];
        queue.push(...next);
      }

      if (hasCycle) {
        return Response.json({ error: "Circular dependency detected" }, { status: 400 });
      }
    }

    // Atomic write: update task and rewrite dependencies together
    const updateQuery = db.update(schema.tasks).set(updates).where(eq(schema.tasks.id, taskId));
    if (dependencies !== undefined) {
      const deleteQuery = db
        .delete(schema.taskDependencies)
        .where(eq(schema.taskDependencies.taskId, taskId));
      if (dependencies.length > 0) {
        const insertQuery = db.insert(schema.taskDependencies).values(
          dependencies.map((depId) => ({
            taskId,
            dependsOnTaskId: depId,
          })),
        );
        await db.batch([updateQuery, deleteQuery, insertQuery]);
      } else {
        await db.batch([updateQuery, deleteQuery]);
      }
    } else {
      await updateQuery;
    }

    return Response.json({ ok: true });
  }

  // -------------------------------------------------------------------------
  // DELETE — delete a task
  // -------------------------------------------------------------------------
  if (request.method === "DELETE") {
    await db.delete(schema.tasks).where(eq(schema.tasks.id, taskId));
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
