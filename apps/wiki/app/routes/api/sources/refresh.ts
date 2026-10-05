import { eq } from "drizzle-orm";
import type { ActionFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/features/auth/utils.server";
import { canAccessSource, enqueueSourceRefresh } from "~/features/sources/sources.server";
import { getDb } from "~/lib/db.server";

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
  if (source.status === "archived") {
    return Response.json({ error: "archived" }, { status: 409 });
  }
  if (source.kind === "conversation") {
    return Response.json({ error: "unsupported_source_kind" }, { status: 409 });
  }

  const result = await enqueueSourceRefresh(env, sourceId);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  return Response.json({ id: sourceId, status: "pending" }, { status: 202 });
}
