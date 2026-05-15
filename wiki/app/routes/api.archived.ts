import { and, desc, eq } from "drizzle-orm";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { deletePageEmbeddings } from "~/lib/embedding-pipeline.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env);

  const isAdmin = !!user.isAdmin;
  const isLead = isAdmin;

  const pages = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      updatedAt: schema.pages.updatedAt,
      authorId: schema.pages.authorId,
    })
    .from(schema.pages)
    .where(
      isLead
        ? eq(schema.pages.status, "archived")
        : and(eq(schema.pages.status, "archived"), eq(schema.pages.authorId, user.id)),
    )
    .orderBy(desc(schema.pages.updatedAt))
    .limit(8)
    .all();

  return Response.json({ pages, isAdmin, isLead, currentUserId: user.id });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env);

  const form = await request.formData();
  const intent = form.get("intent");
  const pageId = form.get("pageId") as string;

  if (!pageId) return Response.json({ ok: false, error: "Missing pageId" }, { status: 400 });

  const page = await db
    .select({ id: schema.pages.id, authorId: schema.pages.authorId })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .get();

  if (!page) return Response.json({ ok: false, error: "Not Found" }, { status: 404 });

  if (intent === "restorePage") {
    if (page.authorId !== user.id && !user.isAdmin) {
      return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    await db
      .update(schema.pages)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(schema.pages.id, pageId));
    return Response.json({ ok: true });
  }

  if (intent === "deletePage") {
    if (!user.isAdmin) {
      return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    try {
      await deletePageEmbeddings(env, db, pageId);
    } catch {
      // best-effort cleanup
    }
    await db.batch([
      db.delete(schema.pageTags).where(eq(schema.pageTags.pageId, pageId)),
      db.delete(schema.pageAttachments).where(eq(schema.pageAttachments.pageId, pageId)),
      db.delete(schema.pageVersions).where(eq(schema.pageVersions.pageId, pageId)),
      db.delete(schema.pages).where(eq(schema.pages.id, pageId)),
    ]);
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: "Unknown intent" }, { status: 400 });
}
