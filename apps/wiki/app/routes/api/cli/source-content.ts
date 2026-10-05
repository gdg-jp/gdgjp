import { getBearerIdentity } from "@gdgjp/gdg-lib";
import { asc, eq } from "drizzle-orm";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import {
  parseWikiCloneLanguage,
  parseWikiHumanDocumentId,
  renderWikiHumanDocument,
} from "~/features/agent-api/cli-wiki-human.server";
import { rawDownloadContentType } from "~/features/agent-api/cli-wiki-raw-content.server";
import { getEffectivePagePermissions } from "~/features/pages/access.server";
import { canAccessSource } from "~/features/sources/sources.server";
import { getDb } from "~/lib/db.server";

/** GET /api/cli/wiki/sources/:documentId/content */
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getBearerIdentity(request, env.ACCOUNTS_URL);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const documentId = params.documentId ?? "";
  if (!documentId) return Response.json({ error: "not_found" }, { status: 404 });

  const db = getDb(env);
  const wikiHumanPageId = parseWikiHumanDocumentId(documentId);

  if (wikiHumanPageId) {
    const lang = parseWikiCloneLanguage(new URL(request.url).searchParams.get("lang"));
    if (!lang) return Response.json({ error: "invalid_lang" }, { status: 400 });

    const page = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.id, wikiHumanPageId))
      .get();
    if (!page || page.origin !== "human" || page.status !== "published") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const permissions = await getEffectivePagePermissions(
      db,
      page,
      identity.user,
      identity.chapters,
    );
    if (!permissions.canView) return Response.json({ error: "forbidden" }, { status: 403 });

    const [tags, access, sources, attachments, parent] = await Promise.all([
      db
        .select()
        .from(schema.pageTags)
        .where(eq(schema.pageTags.pageId, page.id))
        .orderBy(asc(schema.pageTags.tagSlug))
        .all(),
      db
        .select()
        .from(schema.pageAccess)
        .where(eq(schema.pageAccess.pageId, page.id))
        .orderBy(asc(schema.pageAccess.id))
        .all(),
      db
        .select()
        .from(schema.pageSources)
        .where(eq(schema.pageSources.pageId, page.id))
        .orderBy(asc(schema.pageSources.id))
        .all(),
      db
        .select()
        .from(schema.pageAttachments)
        .where(eq(schema.pageAttachments.pageId, page.id))
        .orderBy(asc(schema.pageAttachments.id))
        .all(),
      page.parentId
        ? db
            .select({ slug: schema.pages.slug })
            .from(schema.pages)
            .where(eq(schema.pages.id, page.parentId))
            .get()
        : Promise.resolve(null),
    ]);

    const rendered = renderWikiHumanDocument(
      {
        id: page.id,
        slug: page.slug,
        sortOrder: page.sortOrder,
        pageType: page.pageType,
        pageMetadata: page.pageMetadata,
        visibility: page.visibility,
        generalRole: page.generalRole,
        chapterId: page.chapterId,
        titleJa: page.titleJa,
        titleEn: page.titleEn,
        summaryJa: page.summaryJa,
        summaryEn: page.summaryEn,
        contentJa: page.contentJa,
        contentEn: page.contentEn,
        translationStatusJa: page.translationStatusJa,
        translationStatusEn: page.translationStatusEn,
        parentSlug: parent?.slug ?? null,
        tags: tags.map((row) => row.tagSlug),
        access: access.map(({ subjectType, subjectKey, subjectLabel, role }) => ({
          subjectType,
          subjectKey,
          subjectLabel,
          role,
        })),
        sources: sources.map(({ url, title, sourceId }) => ({ url, title, sourceId })),
        attachments: attachments.map(({ id, r2Key, fileName, mimeType }) => ({
          id,
          r2Key,
          fileName,
          mimeType,
        })),
      },
      lang,
    );

    return new Response(rendered.markdown, {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  }

  const asset = await db
    .select({
      id: schema.sourceAssets.id,
      r2Key: schema.sourceAssets.r2Key,
      mimeType: schema.sourceAssets.mimeType,
      sourceDocumentId: schema.sourceAssets.sourceDocumentId,
    })
    .from(schema.sourceAssets)
    .where(eq(schema.sourceAssets.id, documentId))
    .get();

  if (asset) {
    const doc = await db
      .select({ sourceId: schema.sourceDocuments.sourceId })
      .from(schema.sourceDocuments)
      .where(eq(schema.sourceDocuments.id, asset.sourceDocumentId))
      .get();
    if (!doc) return Response.json({ error: "not_found" }, { status: 404 });
    const source = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, doc.sourceId))
      .get();
    if (!source || source.status !== "ready") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (!canAccessSource(source, identity.user, identity.chapters)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const object = await env.BUCKET.get(asset.r2Key);
    if (!object) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": rawDownloadContentType(asset.mimeType),
        "x-wiki-media-type": asset.mimeType,
      },
    });
  }

  const document = await db
    .select()
    .from(schema.sourceDocuments)
    .where(eq(schema.sourceDocuments.id, documentId))
    .get();
  if (!document || document.status !== "ready") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const source = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.id, document.sourceId))
    .get();
  if (!source || source.status !== "ready") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (!canAccessSource(source, identity.user, identity.chapters)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const object = await env.BUCKET.get(document.r2Key);
  if (!object) return Response.json({ error: "not_found" }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": rawDownloadContentType(document.mediaType),
      "x-wiki-media-type": document.mediaType,
    },
  });
}
