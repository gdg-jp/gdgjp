import { eq } from "drizzle-orm";
import type { ActionFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireRole } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";

// ---------------------------------------------------------------------------
// POST — reorder tasks within a task list
// ---------------------------------------------------------------------------
export async function action({ request, params, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  await requireRole(request, env, "member");
  const db = getDb(env);

  const { taskListId } = params;
  if (!taskListId) return Response.json({ error: "Missing taskListId" }, { status: 400 });

  const body = await request.json();
  const { orderedIds } = body as { orderedIds: string[] };

  if (!Array.isArray(orderedIds)) {
    return Response.json({ error: "orderedIds must be an array" }, { status: 400 });
  }

  // Batch-update sort_order based on array index
  const updates = orderedIds.map((id, index) =>
    db.update(schema.tasks).set({ sortOrder: index }).where(eq(schema.tasks.id, id)),
  );

  if (updates.length > 0) {
    await db.batch(updates as [(typeof updates)[0], ...typeof updates]);
  }

  return Response.json({ ok: true });
}
