import { desc, ne, sql } from "drizzle-orm";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/features/auth/utils.server";
import { canAccessSource, createSource } from "~/features/sources/sources.server";
import { getDb } from "~/lib/db.server";

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
      visibility: schema.sources.visibility,
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
    .where(ne(schema.sources.kind, "conversation"))
    .orderBy(desc(schema.sources.createdAt))
    .all();

  const visible = rows.filter((row) => canAccessSource(row, user, identity.chapters));

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
    visibility?: unknown;
    chapterId?: unknown;
    refreshPolicy?: unknown;
  } | null;

  const result = await createSource(env, {
    url: body?.url,
    visibility: body?.visibility,
    chapter: body?.chapterId,
    refreshPolicy: body?.refreshPolicy,
    user,
    chapters: identity.chapters,
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json(result.source, { status: 202 });
}
