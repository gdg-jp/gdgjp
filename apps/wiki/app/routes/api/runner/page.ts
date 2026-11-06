import { eq } from "drizzle-orm";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireRunner } from "~/features/jobs/runner-routes.server";
import { getDb } from "~/lib/db.server";

/** GET /api/runner/pages/:id — the full (unredacted) Japanese page for a translate job. */
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  requireRunner(request, env);
  const page = await getDb(env)
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      titleJa: schema.pages.titleJa,
      contentJa: schema.pages.contentJa,
      titleEn: schema.pages.titleEn,
      contentEn: schema.pages.contentEn,
      status: schema.pages.status,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, params.id ?? ""))
    .get();
  if (!page || page.status !== "published")
    return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(page);
}
