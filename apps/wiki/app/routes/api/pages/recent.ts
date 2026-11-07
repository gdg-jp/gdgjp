import { and, desc, eq } from "drizzle-orm";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/features/auth/utils.server";
import { agentPagesFilter, pagesInSpaces } from "~/features/pages/page-space.server";
import { buildVisibilityFilter } from "~/features/pages/visibility.server";
import { getWikiAncestry, getWikiPageUrls } from "~/features/pages/wiki-page-path.server";
import { loadViewerContext } from "~/features/spaces/viewer.server";
import { getDb } from "~/lib/db.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const viewer = await loadViewerContext(request, env, identity);
  // Recent pages across every space the viewer can reach.
  const visFilter = and(
    pagesInSpaces(viewer.visibleSpaceIds),
    buildVisibilityFilter(user, identity.chapters),
    agentPagesFilter(viewer.hideAgentPages),
  );

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

  const ids = [...recentUpdated.map((p) => p.id), ...recentViewed.map((p) => p.id)];
  const [urls, chains] = await Promise.all([getWikiPageUrls(env, ids), getWikiAncestry(env, ids)]);
  const parents = (id: string) =>
    (chains.get(id) ?? []).slice(0, -1).map(({ titleJa, titleEn }) => ({ titleJa, titleEn }));

  return Response.json({
    recentUpdated: recentUpdated.map((p) => ({
      ...p,
      wikiPath: urls.get(p.id) ?? "",
      ancestors: parents(p.id),
    })),
    recentViewed: recentViewed.map((p) => ({
      ...p,
      wikiPath: urls.get(p.id) ?? "",
      ancestors: parents(p.id),
    })),
  });
}
