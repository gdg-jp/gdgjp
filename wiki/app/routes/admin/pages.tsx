import { eq } from "drizzle-orm";
import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { deletePageEmbeddings } from "~/features/ai-search/embedding.server";
import { requireAdmin } from "~/features/auth/utils.server";
import { archivePageAndDescendants } from "~/features/pages/archive.server";
import { getDb } from "~/lib/db.server";
import { PageTreeTable } from "./_components/PageTreeTable";
import { buildAdminPageTree } from "./_components/admin-page-tree";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  await requireAdmin(request, env);
  const db = getDb(env);

  const rows = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      status: schema.pages.status,
      visibility: schema.pages.visibility,
      authorId: schema.pages.authorId,
      authorName: schema.user.name,
      createdAt: schema.pages.createdAt,
      updatedAt: schema.pages.updatedAt,
      parentId: schema.pages.parentId,
      sortOrder: schema.pages.sortOrder,
    })
    .from(schema.pages)
    .leftJoin(schema.user, eq(schema.pages.authorId, schema.user.id))
    .orderBy(schema.pages.sortOrder)
    .all();

  return {
    pages: buildAdminPageTree(rows),
  };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  await requireAdmin(request, env);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "deletePage") {
    const pageId = form.get("pageId") as string;
    const db = getDb(env);
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
  }

  if (intent === "archivePage") {
    const pageId = form.get("pageId");
    if (!pageId || typeof pageId !== "string")
      return new Response("Missing pageId", { status: 400 });
    const db = getDb(env);
    await archivePageAndDescendants(env, db, pageId);
  }

  if (intent === "restorePage") {
    const pageId = form.get("pageId");
    if (!pageId || typeof pageId !== "string")
      return new Response("Missing pageId", { status: 400 });
    const db = getDb(env);
    await db
      .update(schema.pages)
      .set({ status: "published", updatedAt: new Date() })
      .where(eq(schema.pages.id, pageId));
  }

  return {};
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export default function AdminPages() {
  const { pages } = useLoaderData<typeof loader>();
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-content-primary">{t("admin.pages.heading")}</h1>
      <PageTreeTable pages={pages} />
    </div>
  );
}
