import { and, eq } from "drizzle-orm";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
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
    .where(eq(schema.pageFavorites.userId, sessionUser.id))
    .all();

  return Response.json({ favorites });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const sessionUser = await requireUser(request, env);
  const db = getDb(env);

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "toggle") {
    const pageId = form.get("pageId");
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
