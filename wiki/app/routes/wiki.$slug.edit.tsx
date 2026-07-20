import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { redirect } from "react-router";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import PageEditor from "~/components/PageEditor";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { getEffectivePagePermissions } from "~/lib/page-access.server";
import { tiptapToMarkdown } from "~/lib/tiptap-convert";

// ---------------------------------------------------------------------------
// Revalidation
// ---------------------------------------------------------------------------

export function shouldRevalidate({
  actionResult,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  // Don't revalidate after a successful save/autosave — loader data hasn't changed
  if (actionResult && (actionResult as { ok?: boolean }).ok) return false;
  return defaultShouldRevalidate;
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  {
    title: data
      ? `Editing: ${data.page.titleEn || data.page.titleJa} — GDG Japan Wiki`
      : "Edit page",
  },
];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const page = await db
    .select({
      id: schema.pages.id,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      slug: schema.pages.slug,
      status: schema.pages.status,
      contentJa: schema.pages.contentJa,
      contentEn: schema.pages.contentEn,
      visibility: schema.pages.visibility,
      generalRole: schema.pages.generalRole,
      chapterId: schema.pages.chapterId,
      authorId: schema.pages.authorId,
    })
    .from(schema.pages)
    .where(eq(schema.pages.slug, params.slug ?? ""))
    .get();

  if (!page) throw new Response("Not Found", { status: 404 });
  if (page.status === "archived") throw new Response("Not Found", { status: 404 });

  const permissions = await getEffectivePagePermissions(db, page, user, identity.chapterIds);
  if (!permissions.canEdit) {
    throw new Response("Forbidden", { status: 403 });
  }

  return {
    page: {
      ...page,
      contentJa: tiptapToMarkdown(page.contentJa ?? ""),
      contentEn: tiptapToMarkdown(page.contentEn ?? ""),
    },
    canPublish: !!user.isAdmin,
    currentUser: { id: user.id, name: user.name, image: user.image ?? null },
  };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const formData = await request.formData();
  const intent = formData.get("intent") as "save" | "publish" | "autosave";
  const titleJa = (formData.get("titleJa") as string) ?? "";
  const titleEn = (formData.get("titleEn") as string) ?? "";
  const contentJa = (formData.get("contentJa") as string) ?? "";
  const contentEn = (formData.get("contentEn") as string) ?? "";

  const page = await db
    .select({
      id: schema.pages.id,
      status: schema.pages.status,
      authorId: schema.pages.authorId,
      contentJa: schema.pages.contentJa,
      contentEn: schema.pages.contentEn,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      visibility: schema.pages.visibility,
      generalRole: schema.pages.generalRole,
    })
    .from(schema.pages)
    .where(eq(schema.pages.slug, params.slug ?? ""))
    .get();

  if (!page) throw new Response("Not Found", { status: 404 });

  const permissions = await getEffectivePagePermissions(db, page, user, identity.chapterIds);
  if (!permissions.canEdit) {
    throw new Response("Forbidden", { status: 403 });
  }

  const isPublish = intent === "publish" && !!user.isAdmin;
  const newStatus = isPublish ? "published" : page.status;

  const versionId = nanoid();
  const now = Math.floor(Date.now() / 1000);

  const statements = [
    // Snapshot current content before overwriting
    env.DB.prepare(
      `INSERT INTO page_versions (id, page_id, content_ja, content_en, title_ja, title_en, edited_by, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      versionId,
      page.id,
      page.contentJa,
      page.contentEn,
      page.titleJa,
      page.titleEn,
      user.id,
      now,
    ),

    // Update page
    env.DB.prepare(
      `UPDATE pages SET title_ja = ?, title_en = ?, content_ja = ?, content_en = ?,
        status = ?, last_edited_by = ?, updated_at = unixepoch()
       WHERE id = ?`,
    ).bind(titleJa, titleEn, contentJa, contentEn, newStatus, user.id, page.id),

    // Prune old versions — keep last 10
    env.DB.prepare(
      `DELETE FROM page_versions WHERE page_id = ? AND id NOT IN (
         SELECT id FROM page_versions WHERE page_id = ? ORDER BY saved_at DESC LIMIT 10
       )`,
    ).bind(page.id, page.id),
  ];

  await env.DB.batch(statements);

  if (isPublish) {
    await env.TRANSLATION_QUEUE.send({ pageId: page.id });
    return redirect(`/wiki/${params.slug}`);
  }

  const savedAt = new Date().toISOString();

  if (intent === "autosave") {
    return Response.json({ ok: true, savedAt });
  }

  // intent === "save"
  return Response.json({ ok: true, savedAt });
}

// ---------------------------------------------------------------------------
// Route component
// ---------------------------------------------------------------------------

export default function EditPage() {
  const { page, canPublish, currentUser } = useLoaderData<typeof loader>();

  return <PageEditor page={page} canPublish={canPublish} currentUser={currentUser} />;
}
