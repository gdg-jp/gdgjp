import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { redirect } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/features/auth/utils.server";
import { canonicalMarkdown } from "~/features/editor/content-format";
import { getEffectivePagePermissions } from "~/features/pages/access.server";
import { computeAclSourceIdsJson } from "~/features/pages/acl-spans";
import {
  pageAclClearance,
  redactPageMarkdown,
  validatePageAclForSync,
} from "~/features/pages/acl-spans.server";
import { wikiPagePath } from "~/features/pages/wiki-page-path";
import { getWikiCanonicalSlugPath } from "~/features/pages/wiki-page-path.server";
import { getDb } from "~/lib/db.server";

type VersionRow = {
  id: string;
  titleJa: string;
  titleEn: string;
  editedBy: string;
  savedAt: number;
  editorName: string | null;
};

type VersionRaw = {
  id: string;
  title_ja: string;
  title_en: string;
  edited_by: string;
  saved_at: number;
  editor_name: string | null;
};

type VersionFullRaw = VersionRaw & {
  content_ja: string;
  content_en: string;
};

/** Data assembly behind the `/wiki/:slug/history` loader. */
export async function loadPageHistory(request: Request, env: Env, slug: string | undefined) {
  const sessionUser = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const page = await db
    .select({
      id: schema.pages.id,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      slug: schema.pages.slug,
      status: schema.pages.status,
      visibility: schema.pages.visibility,
      generalRole: schema.pages.generalRole,
      chapterId: schema.pages.chapterId,
      authorId: schema.pages.authorId,
      contentJa: schema.pages.contentJa,
      contentEn: schema.pages.contentEn,
    })
    .from(schema.pages)
    .where(eq(schema.pages.slug, slug ?? ""))
    .get();

  if (!page || page.status !== "published") {
    throw new Response("Not Found", { status: 404 });
  }

  const permissions = await getEffectivePagePermissions(db, page, sessionUser, identity.chapters);
  if (!permissions.canView) {
    throw new Response("Not Found", { status: 404 });
  }

  const versionsResult = (await env.DB.prepare(
    `SELECT pv.id, pv.title_ja, pv.title_en, pv.edited_by, pv.saved_at,
            u.name AS editor_name
     FROM page_versions pv
     LEFT JOIN user u ON pv.edited_by = u.id
     WHERE pv.page_id = ?
     ORDER BY pv.saved_at DESC
     LIMIT 10`,
  )
    .bind(page.id)
    .all()) as { results: VersionRaw[] };

  const versions: VersionRow[] = (versionsResult.results ?? []).map((r) => ({
    id: r.id,
    titleJa: r.title_ja,
    titleEn: r.title_en,
    editedBy: r.edited_by,
    savedAt: r.saved_at,
    editorName: r.editor_name,
  }));

  const url = new URL(request.url);
  const langParam = url.searchParams.get("lang");
  const lang: "ja" | "en" = langParam === "ja" || langParam === "en" ? langParam : "ja";
  const versionId = url.searchParams.get("v");

  let selectedVersion: {
    id: string;
    titleJa: string;
    titleEn: string;
    contentJa: string;
    contentEn: string;
    savedAt: number;
    editorName: string | null;
  } | null = null;

  if (versionId) {
    const vRow = (await env.DB.prepare(
      `SELECT pv.id, pv.title_ja, pv.title_en, pv.content_ja, pv.content_en, pv.saved_at,
              u.name AS editor_name
       FROM page_versions pv
       LEFT JOIN user u ON pv.edited_by = u.id
       WHERE pv.id = ? AND pv.page_id = ?`,
    )
      .bind(versionId, page.id)
      .first()) as VersionFullRaw | null;

    if (vRow) {
      selectedVersion = {
        id: vRow.id,
        titleJa: vRow.title_ja,
        titleEn: vRow.title_en,
        contentJa: await redactPageMarkdown(
          db,
          canonicalMarkdown(vRow.content_ja ?? ""),
          sessionUser,
          identity.chapters,
        ),
        contentEn: await redactPageMarkdown(
          db,
          canonicalMarkdown(vRow.content_en ?? ""),
          sessionUser,
          identity.chapters,
        ),
        savedAt: vRow.saved_at,
        editorName: vRow.editor_name,
      };
    }
  }

  const canRevert =
    permissions.canEdit &&
    (await pageAclClearance(db, [page.contentJa, page.contentEn], sessionUser, identity.chapters));
  const wikiPath = wikiPagePath(await getWikiCanonicalSlugPath(env, page.id));

  return {
    page: {
      slug: page.slug,
      titleJa: page.titleJa,
      titleEn: page.titleEn,
      currentContentJa: await redactPageMarkdown(
        db,
        canonicalMarkdown(page.contentJa),
        sessionUser,
        identity.chapters,
      ),
      currentContentEn: await redactPageMarkdown(
        db,
        canonicalMarkdown(page.contentEn),
        sessionUser,
        identity.chapters,
      ),
      wikiPath,
    },
    versions,
    selectedVersion,
    lang,
    canRevert,
  };
}

/** Revert a page to a stored version — behind the `/wiki/:slug/history` action. */
export async function revertPageVersion(request: Request, env: Env, slug: string | undefined) {
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);

  const formData = await request.formData();
  const intent = formData.get("intent");
  const versionId = formData.get("versionId") as string | null;

  if (intent !== "revert" || !versionId) {
    throw new Response("Bad Request", { status: 400 });
  }

  const db = getDb(env);
  const page = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      authorId: schema.pages.authorId,
      contentJa: schema.pages.contentJa,
      contentEn: schema.pages.contentEn,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      status: schema.pages.status,
      visibility: schema.pages.visibility,
      generalRole: schema.pages.generalRole,
    })
    .from(schema.pages)
    .where(eq(schema.pages.slug, slug ?? ""))
    .get();

  if (!page || page.status !== "published") throw new Response("Not Found", { status: 404 });

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

  const vRow = (await env.DB.prepare(
    `SELECT content_ja, content_en, title_ja, title_en
     FROM page_versions WHERE id = ? AND page_id = ?`,
  )
    .bind(versionId, page.id)
    .first()) as {
    content_ja: string;
    content_en: string;
    title_ja: string;
    title_en: string;
  } | null;

  if (!vRow) throw new Response("Version Not Found", { status: 404 });

  const snapshotId = nanoid();
  const now = Math.floor(Date.now() / 1000);
  const restoredJa = canonicalMarkdown(vRow.content_ja);
  const restoredEn = canonicalMarkdown(vRow.content_en);

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
      ja: { title: vRow.title_ja, content: restoredJa },
      en: { title: vRow.title_en, content: restoredEn },
    },
    {
      pageVisibility: page.visibility,
      pageAccess: accessRows,
      citedSourceIds: sourceRows
        .map((row) => row.sourceId)
        .filter(
          (sourceId): sourceId is string => typeof sourceId === "string" && sourceId.length > 0,
        ),
      contentJa: restoredJa,
      contentEn: restoredEn,
    },
    user,
    identity.chapters,
  );
  if (!aclValidation.ok) {
    throw new Response(aclValidation.error, { status: 400 });
  }

  const aclSourceIdsJson = computeAclSourceIdsJson(restoredJa, restoredEn);

  await env.DB.batch([
    // Snapshot current state before overwriting
    env.DB.prepare(
      `INSERT INTO page_versions (id, page_id, content_ja, content_en, title_ja, title_en, edited_by, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      snapshotId,
      page.id,
      canonicalMarkdown(page.contentJa),
      canonicalMarkdown(page.contentEn),
      page.titleJa,
      page.titleEn,
      user.id,
      now,
    ),
    // Overwrite with version content
    env.DB.prepare(
      `UPDATE pages SET title_ja = ?, title_en = ?, content_ja = ?, content_en = ?,
          acl_source_ids = ?, last_edited_by = ?, updated_at = unixepoch() WHERE id = ?`,
    ).bind(
      vRow.title_ja,
      vRow.title_en,
      restoredJa,
      restoredEn,
      aclSourceIdsJson,
      user.id,
      page.id,
    ),
    // Prune — keep last 10
    env.DB.prepare(
      `DELETE FROM page_versions WHERE page_id = ? AND id NOT IN (
         SELECT id FROM page_versions WHERE page_id = ? ORDER BY saved_at DESC LIMIT 10
       )`,
    ).bind(page.id, page.id),
  ]);

  return redirect(wikiPagePath(await getWikiCanonicalSlugPath(env, page.id)));
}
