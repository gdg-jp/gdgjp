import { and, eq, inArray } from "drizzle-orm";
import type { ActionFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";

// ---------------------------------------------------------------------------
// POST — reorder tasks within a task list
// ---------------------------------------------------------------------------
export async function action({ request, params, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env);

  const { taskListId } = params;
  if (!taskListId) return Response.json({ error: "Missing taskListId" }, { status: 400 });

  // Only the task list's page author or an admin may reorder.
  const page = await db
    .select({ authorId: schema.pages.authorId })
    .from(schema.pages)
    .where(eq(schema.pages.id, taskListId))
    .get();

  if (!page) return Response.json({ error: "Task list not found" }, { status: 404 });
  if (!user.isAdmin && page.authorId !== user.id) {
    return new Response("Forbidden", { status: 403 });
  }

  const body = await request.json();
  const { orderedIds } = body as { orderedIds: string[] };

  if (!Array.isArray(orderedIds)) {
    return Response.json({ error: "orderedIds must be an array" }, { status: 400 });
  }
  if (orderedIds.length === 0) return Response.json({ ok: true });

  // Verify every supplied id actually belongs to this task list — without
  // this check, a caller who can manage one list could pass ids from any
  // other list and reshuffle them.
  const belonging = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.taskListId, taskListId), inArray(schema.tasks.id, orderedIds)))
    .all();

  if (belonging.length !== orderedIds.length) {
    return Response.json({ error: "task ids do not match this task list" }, { status: 400 });
  }

  // Batch-update sort_order based on array index
  const updates = orderedIds.map((id, index) =>
    db
      .update(schema.tasks)
      .set({ sortOrder: index })
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.taskListId, taskListId))),
  );

  await db.batch(updates as [(typeof updates)[0], ...typeof updates]);

  return Response.json({ ok: true });
}
