import { eq } from "drizzle-orm";
import type { ActionFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { readJson, requireRunner } from "~/features/jobs/runner-routes.server";
import { applyTranslation } from "~/features/jobs/translate.server";
import { scheduleKnowledgeSync } from "~/features/knowledge/sync.server";
import { getDb } from "~/lib/db.server";

/** POST /api/runner/pages/:id/translation { titleEn, contentEn, sourceHash } */
export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env, ctx } = context.cloudflare;
  requireRunner(request, env);
  const body = await readJson<{ titleEn?: unknown; contentEn?: unknown; sourceHash?: unknown }>(
    request,
  );
  if (!body || typeof body.contentEn !== "string" || typeof body.sourceHash !== "string") {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const db = getDb(env);
  const result = await applyTranslation(db, {
    pageId: params.id ?? "",
    sourceHash: body.sourceHash,
    titleEn: typeof body.titleEn === "string" ? body.titleEn : "",
    contentEn: body.contentEn,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  const page = await db
    .select({ spaceId: schema.pages.spaceId })
    .from(schema.pages)
    .where(eq(schema.pages.id, params.id ?? ""))
    .get();
  if (page) ctx.waitUntil(scheduleKnowledgeSync(env, page.spaceId));
  return Response.json({ ok: true });
}
