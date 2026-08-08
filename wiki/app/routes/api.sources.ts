import { desc, sql } from "drizzle-orm";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { canAccessSource, createSource } from "~/lib/sources.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const rows = await db
    .select({
      id: schema.sources.id,
      kind: schema.sources.kind,
      url: schema.sources.url,
      title: schema.sources.title,
      chapterId: schema.sources.chapterId,
      addedBy: schema.sources.addedBy,
      status: schema.sources.status,
      refreshPolicy: schema.sources.refreshPolicy,
      lastFetchedAt: schema.sources.lastFetchedAt,
      errorMessage: schema.sources.errorMessage,
      createdAt: schema.sources.createdAt,
      documentCount: sql<number>`(
        select count(*) from source_documents sd where sd.source_id = ${schema.sources.id}
      )`,
    })
    .from(schema.sources)
    .orderBy(desc(schema.sources.createdAt))
    .all();

  const visible = rows.filter((row) => canAccessSource(row, user, identity.chapterIds));

  return Response.json({ sources: visible });
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const body = (await request.json().catch(() => null)) as {
    url?: unknown;
    chapterId?: unknown;
    refreshPolicy?: unknown;
  } | null;

  const result = await createSource(env, {
    url: body?.url,
    chapter: body?.chapterId,
    refreshPolicy: body?.refreshPolicy,
    user,
    chapterIds: identity.chapterIds,
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json(result.source, { status: 202 });
}
