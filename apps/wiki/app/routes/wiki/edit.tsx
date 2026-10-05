import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/features/auth/utils.server";
import { canonicalMarkdown } from "~/features/editor/content-format";
import { getEffectivePagePermissions } from "~/features/pages/access.server";
import { computeAclSourceIdsJson } from "~/features/pages/acl-spans";
import { pageAclClearance, validatePageAclForSync } from "~/features/pages/acl-spans.server";
import PageEditor from "~/features/pages/components/PageEditor";
import { wikiPagePath } from "~/features/pages/wiki-page-path";
import { getWikiCanonicalSlugPath } from "~/features/pages/wiki-page-path.server";
import { getDb } from "~/lib/db.server";

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
      translationStatusEn: schema.pages.translationStatusEn,
      slug: schema.pages.slug,
      status: schema.pages.status,
      contentJa: schema.pages.contentJa,
      contentEn: schema.pages.contentEn,
      visibility: schema.pages.visibility,
      generalRole: schema.pages.generalRole,
      chapterId: schema.pages.chapterId,
      authorId: schema.pages.authorId,
      origin: schema.pages.origin,
      pageType: schema.pages.pageType,
    })
    .from(schema.pages)
    .where(eq(schema.pages.slug, params.slug ?? ""))
    .get();

  if (!page) throw new Response("Not Found", { status: 404 });
  if (page.status === "archived") throw new Response("Not Found", { status: 404 });
  if (
    page.pageType === "wiki-index" ||
    page.pageType === "wiki-log" ||
    page.slug === "index" ||
    page.slug === "log"
  ) {
    throw new Response("This page is maintained by the ingest toolchain", { status: 403 });
  }

  const permissions = await getEffectivePagePermissions(db, page, user, identity.chapters);
  if (!permissions.canEdit) {
    throw new Response("Forbidden", { status: 403 });
  }

  const clearance = await pageAclClearance(
    db,
    [page.contentJa, page.contentEn],
    user,
    identity.chapters,
  );
  if (!clearance) {
    throw new Response("Forbidden", { status: 403 });
  }

  return {
    page: {
      ...page,
      contentJa: canonicalMarkdown(page.contentJa),
      contentEn: canonicalMarkdown(page.contentEn),
      wikiPath: wikiPagePath(await getWikiCanonicalSlugPath(env, page.id)),
    },
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
  const intent = formData.get("intent") as "save" | "autosave";
  const titleJa = (formData.get("titleJa") as string) ?? "";
  const titleEn = (formData.get("titleEn") as string) ?? "";
  const contentJa = canonicalMarkdown((formData.get("contentJa") as string) ?? "");
  const contentEn = canonicalMarkdown((formData.get("contentEn") as string) ?? "");

  const page = await db
    .select({
      id: schema.pages.id,
      status: schema.pages.status,
      authorId: schema.pages.authorId,
      contentJa: schema.pages.contentJa,
      contentEn: schema.pages.contentEn,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      translationStatusEn: schema.pages.translationStatusEn,
      visibility: schema.pages.visibility,
      generalRole: schema.pages.generalRole,
      origin: schema.pages.origin,
      pageType: schema.pages.pageType,
    })
    .from(schema.pages)
    .where(eq(schema.pages.slug, params.slug ?? ""))
    .get();

  if (!page) throw new Response("Not Found", { status: 404 });
  const slug = params.slug ?? "";
  if (
    page.pageType === "wiki-index" ||
    page.pageType === "wiki-log" ||
    slug === "index" ||
    slug === "log"
  ) {
    throw new Response("This page is maintained by the ingest toolchain", { status: 403 });
  }

  const permissions = await getEffectivePagePermissions(db, page, user, identity.chapters);
  if (!permissions.canEdit) {
    throw new Response("Forbidden", { status: 403 });
  }

  const clearance = await pageAclClearance(
    db,
    [page.contentJa, page.contentEn],
    user,
    identity.chapters,
  );
  if (!clearance) {
    throw new Response("Forbidden", { status: 403 });
  }

  const [accessRows, sourceRows] = await Promise.all([
    db
      .select({
        subjectType: schema.pageAccess.subjectType,
        subjectKey: schema.pageAccess.subjectKey,
      })
      .from(schema.pageAccess)
      .where(eq(schema.pageAccess.pageId, page.id))
      .all(),
    db
      .select({ sourceId: schema.pageSources.sourceId })
      .from(schema.pageSources)
      .where(eq(schema.pageSources.pageId, page.id))
      .all(),
  ]);
  const aclValidation = await validatePageAclForSync(
    db,
    {
      ja: { title: titleJa, content: contentJa },
      en: { title: titleEn, content: contentEn },
    },
    {
      pageVisibility: page.visibility,
      pageAccess: accessRows,
      citedSourceIds: sourceRows
        .map((row) => row.sourceId)
        .filter(
          (sourceId): sourceId is string => typeof sourceId === "string" && sourceId.length > 0,
        ),
      contentJa,
      contentEn,
    },
    user,
    identity.chapters,
  );
  if (!aclValidation.ok) {
    return Response.json(
      {
        error: aclValidation.error,
        ...(aclValidation.sourceId ? { sourceId: aclValidation.sourceId } : {}),
      },
      { status: 400 },
    );
  }

  const versionId = nanoid();
  const now = Math.floor(Date.now() / 1000);
  const aclSourceIdsJson = computeAclSourceIdsJson(contentJa, contentEn);
  const englishChanged =
    titleEn !== page.titleEn || contentEn !== canonicalMarkdown(page.contentEn);
  let translationStatusEn = page.translationStatusEn;
  if (englishChanged) {
    translationStatusEn = titleEn.trim() || contentEn.trim() ? "human" : "missing";
  }

  const statements = [
    // Snapshot current content before overwriting
    env.DB.prepare(
      `INSERT INTO page_versions (id, page_id, content_ja, content_en, title_ja, title_en, edited_by, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      versionId,
      page.id,
      canonicalMarkdown(page.contentJa),
      canonicalMarkdown(page.contentEn),
      page.titleJa,
      page.titleEn,
      user.id,
      now,
    ),

    // Update page
    env.DB.prepare(
      `UPDATE pages SET title_ja = ?, title_en = ?, content_ja = ?, content_en = ?,
        translation_status_en = ?, acl_source_ids = ?, last_edited_by = ?, updated_at = unixepoch()
       WHERE id = ?`,
    ).bind(
      titleJa,
      titleEn,
      contentJa,
      contentEn,
      translationStatusEn,
      aclSourceIdsJson,
      user.id,
      page.id,
    ),

    // Prune old versions — keep last 10
    env.DB.prepare(
      `DELETE FROM page_versions WHERE page_id = ? AND id NOT IN (
         SELECT id FROM page_versions WHERE page_id = ? ORDER BY saved_at DESC LIMIT 10
       )`,
    ).bind(page.id, page.id),
  ];

  await env.DB.batch(statements);

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
  const { page, currentUser } = useLoaderData<typeof loader>();

  return <PageEditor page={page} currentUser={currentUser} />;
}
