import { and, eq } from "drizzle-orm";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/features/auth/utils.server";
import { pagesInSpaces } from "~/features/pages/page-space.server";
import { getWikiPageUrls } from "~/features/pages/wiki-page-path.server";
import { requirePageSpace } from "~/features/spaces/access.server";
import { loadViewerContext } from "~/features/spaces/viewer.server";
import { getDb } from "~/lib/db.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const sessionUser = await requireUser(request, env);
  const db = getDb(env);

  const favorites = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
    })
    .from(schema.pageFavorites)
    .innerJoin(schema.pages, eq(schema.pageFavorites.pageId, schema.pages.id))
    .where(
      and(
        eq(schema.pageFavorites.userId, sessionUser.id),
        pagesInSpaces((await loadViewerContext(request, env)).visibleSpaceIds),
      ),
    )
    .all();

  const urls = await getWikiPageUrls(
    env,
    favorites.map((p) => p.id),
  );

  return Response.json({
    favorites: favorites.map((p) => ({
      ...p,
      wikiPath: urls.get(p.id) ?? "",
    })),
  });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const sessionUser = await requireUser(request, env);
  const db = getDb(env);

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "toggle") {
    const pageId = form.get("pageId");
    if (typeof pageId === "string" && pageId) {
      await requirePageSpace(db, await getAccessIdentity(request, env), pageId);
    }
    if (typeof pageId !== "string" || !pageId) {
      return Response.json({ ok: false, error: "missing pageId" }, { status: 400 });
    }

    const existing = await db
      .select()
      .from(schema.pageFavorites)
      .where(
        and(
          eq(schema.pageFavorites.userId, sessionUser.id),
          eq(schema.pageFavorites.pageId, pageId),
        ),
      )
      .get();

    if (existing) {
      await db
        .delete(schema.pageFavorites)
        .where(
          and(
            eq(schema.pageFavorites.userId, sessionUser.id),
            eq(schema.pageFavorites.pageId, pageId),
          ),
        );
      return Response.json({ ok: true, starred: false });
    }
    await db.insert(schema.pageFavorites).values({
      userId: sessionUser.id,
      pageId,
    });
    return Response.json({ ok: true, starred: true });
  }

  return Response.json({ ok: false, error: "unknown intent" }, { status: 400 });
}
