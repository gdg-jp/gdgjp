import { and, desc, eq } from "drizzle-orm";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { buildVisibilityFilter } from "~/lib/page-visibility.server";
import { wikiPagePath } from "~/lib/wiki-page-path";
import { getWikiCanonicalSlugPaths } from "~/lib/wiki-page-path.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const visFilter = buildVisibilityFilter(user, identity.chapters);

  const [recentUpdated, recentViewed] = await Promise.all([
    db
      .select({
        id: schema.pages.id,
        slug: schema.pages.slug,
        titleJa: schema.pages.titleJa,
        titleEn: schema.pages.titleEn,
        updatedAt: schema.pages.updatedAt,
      })
      .from(schema.pages)
      .where(and(eq(schema.pages.status, "published"), visFilter))
      .orderBy(desc(schema.pages.updatedAt))
      .limit(8)
      .all(),

    db
      .select({
        id: schema.pages.id,
        slug: schema.pages.slug,
        titleJa: schema.pages.titleJa,
        titleEn: schema.pages.titleEn,
        viewedAt: schema.pageViews.viewedAt,
      })
      .from(schema.pageViews)
      .innerJoin(schema.pages, eq(schema.pageViews.pageId, schema.pages.id))
      .where(
        and(eq(schema.pageViews.userId, user.id), eq(schema.pages.status, "published"), visFilter),
      )
      .orderBy(desc(schema.pageViews.viewedAt))
      .limit(8)
      .all(),
  ]);

  const slugPaths = await getWikiCanonicalSlugPaths(env, [
    ...recentUpdated.map((p) => p.id),
    ...recentViewed.map((p) => p.id),
  ]);

  return Response.json({
    recentUpdated: recentUpdated.map((p) => ({
      ...p,
      wikiPath: wikiPagePath(slugPaths.get(p.id) ?? [p.slug]),
    })),
    recentViewed: recentViewed.map((p) => ({
      ...p,
      wikiPath: wikiPagePath(slugPaths.get(p.id) ?? [p.slug]),
    })),
  });
}
