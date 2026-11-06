import { ne, notInArray } from "drizzle-orm";
import { and } from "drizzle-orm";
import type { ActionFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireAdmin } from "~/features/auth/utils.server";
import { NON_REFRESHABLE_KINDS } from "~/features/sources/kinds";
import { enqueueSourceRefresh } from "~/features/sources/sources.server";
import { getDb } from "~/lib/db.server";

/**
 * POST /api/admin/refresh-all-sources — refresh every source once so its documents move to
 * the v2 R2 layout (`spaces/<space>/raw/…`) with audience metadata. Progress is visible as
 * `SELECT count(*) FROM source_documents WHERE r2_key LIKE 'spaces/%'`.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const { env } = context.cloudflare;
  await requireAdmin(request, env);
  const sources = await getDb(env)
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(
      and(
        ne(schema.sources.status, "archived"),
        notInArray(schema.sources.kind, [...NON_REFRESHABLE_KINDS]),
      ),
    )
    .all();
  const results = { queued: 0, skipped: 0 };
  for (const source of sources) {
    const result = await enqueueSourceRefresh(env, source.id);
    if (result.ok) results.queued += 1;
    else results.skipped += 1;
  }
  return Response.json(results);
}
