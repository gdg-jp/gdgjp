import { eq } from "drizzle-orm";
import type { ActionFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { canAccessSource } from "~/lib/sources.server";

export async function action({ request, context, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const sourceId = params.id;
  if (!sourceId) return Response.json({ error: "not_found" }, { status: 404 });

  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const source = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.id, sourceId))
    .get();
  if (!source) return Response.json({ error: "not_found" }, { status: 404 });
  if (!canAccessSource(source, user, identity.chapters)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  await db
    .update(schema.sources)
    .set({ status: "archived", fetchAttemptId: null, updatedAt: new Date() })
    .where(eq(schema.sources.id, sourceId));

  return Response.json({ id: sourceId, status: "archived" });
}
