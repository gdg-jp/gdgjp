import { asc, eq } from "drizzle-orm";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getCliIdentity } from "~/lib/cli-identity.server";
import {
  parseWikiCloneLanguage,
  renderWikiHumanDocument,
  sha256Hex,
  wikiHumanDocumentId,
} from "~/lib/cli-wiki-human.server";
import {
  disambiguateRawManifestPaths,
  rawSourceDirectories,
  wikiHumanRawPath,
} from "~/lib/cli-wiki-source-path.server";
import { getDb } from "~/lib/db.server";
import { getEffectivePagePermissions } from "~/lib/page-access.server";
import { canAccessSource } from "~/lib/sources.server";
import type { components } from "../../openapi/types.generated";

type SourcesManifest = components["schemas"]["SourcesManifest"];
type SourcesManifestEntry = components["schemas"]["SourcesManifestEntry"];

function toUnixSeconds(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  return value;
}

/** GET /api/cli/wiki/sources — manifest of raw documents for gdg wiki raw pull. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getCliIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const lang = parseWikiCloneLanguage(new URL(request.url).searchParams.get("lang"));
  if (!lang) return Response.json({ error: "invalid_lang" }, { status: 400 });

  const db = getDb(env);
  const chapterIds = identity.chapters.map((chapter) => String(chapter.chapterId));

  const [documents, assets, ingestions, pages, tags, access, pageSources, attachments, allPages] =
    await Promise.all([
      db
        .select({
          id: schema.sourceDocuments.id,
          sourceId: schema.sourceDocuments.sourceId,
          path: schema.sourceDocuments.path,
          title: schema.sourceDocuments.title,
          mediaType: schema.sourceDocuments.mediaType,
          contentHash: schema.sourceDocuments.contentHash,
          capturedAt: schema.sourceDocuments.capturedAt,
        })
        .from(schema.sourceDocuments)
        .where(eq(schema.sourceDocuments.status, "ready"))
        .all(),
      db
        .select({
          id: schema.sourceAssets.id,
          sourceDocumentId: schema.sourceAssets.sourceDocumentId,
          path: schema.sourceAssets.path,
          title: schema.sourceDocuments.title,
          contentHash: schema.sourceAssets.contentHash,
          mediaType: schema.sourceAssets.mimeType,
          capturedAt: schema.sourceDocuments.capturedAt,
        })
        .from(schema.sourceAssets)
        .innerJoin(
          schema.sourceDocuments,
          eq(schema.sourceAssets.sourceDocumentId, schema.sourceDocuments.id),
        )
        .all(),
      db.select().from(schema.sourceDocumentIngestions).all(),
      db.select().from(schema.pages).where(eq(schema.pages.origin, "human")).all(),
      db
        .select()
        .from(schema.pageTags)
        .orderBy(asc(schema.pageTags.pageId), asc(schema.pageTags.tagSlug))
        .all(),
      db
        .select()
        .from(schema.pageAccess)
        .orderBy(asc(schema.pageAccess.pageId), asc(schema.pageAccess.id))
        .all(),
      db
        .select()
        .from(schema.pageSources)
        .orderBy(asc(schema.pageSources.pageId), asc(schema.pageSources.id))
        .all(),
      db
        .select()
        .from(schema.pageAttachments)
        .orderBy(asc(schema.pageAttachments.pageId), asc(schema.pageAttachments.id))
        .all(),
      db
        .select({ id: schema.pages.id, slug: schema.pages.slug, parentId: schema.pages.parentId })
        .from(schema.pages)
        .all(),
    ]);

  const sources = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.status, "ready"))
    .all();
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const sourceDirectoryByID = rawSourceDirectories(sources);
  const ingestionByDocId = new Map(ingestions.map((row) => [row.documentId, row.contentHash]));
  const slugById = new Map(allPages.map((page) => [page.id, page.slug]));
  const pagePathByID = new Map(allPages.map((page) => [page.id, page]));
  const manifestEntries: SourcesManifestEntry[] = [];

  for (const doc of documents) {
    const source = sourceById.get(doc.sourceId);
    if (!source || !canAccessSource(source, identity.user, chapterIds)) continue;
    manifestEntries.push({
      kind: "source-document",
      documentId: doc.id,
      sourceId: doc.sourceId,
      title: doc.title,
      path: `raw/${sourceDirectoryByID.get(source.id)}/${doc.path}`,
      contentHash: doc.contentHash,
      mediaType: doc.mediaType,
      capturedAt: toUnixSeconds(doc.capturedAt),
      ingestedHash: ingestionByDocId.get(doc.id) ?? null,
    });
  }

  for (const asset of assets) {
    const doc = documents.find((row) => row.id === asset.sourceDocumentId);
    if (!doc) continue;
    const source = sourceById.get(doc.sourceId);
    if (!source || !canAccessSource(source, identity.user, chapterIds)) continue;
    const fileName = asset.path.split("/").at(-1) ?? asset.path;
    manifestEntries.push({
      kind: "source-asset",
      documentId: asset.id,
      sourceId: doc.sourceId,
      title: asset.title || fileName,
      path: `raw/${sourceDirectoryByID.get(source.id)}/assets/${assetRelativePath(asset.path, doc.sourceId)}`,
      contentHash: asset.contentHash,
      mediaType: asset.mediaType,
      capturedAt: toUnixSeconds(asset.capturedAt),
      ingestedHash: ingestionByDocId.get(asset.id) ?? null,
    });
  }

  for (const page of pages) {
    if (page.status !== "published") continue;
    const permissions = await getEffectivePagePermissions(
      db,
      page,
      identity.user,
      identity.chapters,
    );
    if (!permissions.canView) continue;

    const pageTags = tags.filter((row) => row.pageId === page.id).map((row) => row.tagSlug);
    const pageAccess = access
      .filter((row) => row.pageId === page.id)
      .map(({ subjectType, subjectKey, subjectLabel, role }) => ({
        subjectType,
        subjectKey,
        subjectLabel,
        role,
      }));
    const pageSourceRows = pageSources
      .filter((row) => row.pageId === page.id)
      .map(({ url, title, sourceId }) => ({ url, title, sourceId }));
    const pageAttachmentRows = attachments
      .filter((row) => row.pageId === page.id)
      .map(({ id, r2Key, fileName, mimeType }) => ({ id, r2Key, fileName, mimeType }));

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
        parentSlug: page.parentId ? (slugById.get(page.parentId) ?? null) : null,
        tags: pageTags,
        access: pageAccess,
        sources: pageSourceRows,
        attachments: pageAttachmentRows,
      },
      lang,
    );
    const contentHash = await sha256Hex(rendered.markdown);
    const documentId = wikiHumanDocumentId(page.id);
    manifestEntries.push({
      kind: "wiki-human",
      documentId,
      sourceId: null,
      title: rendered.title || page.slug,
      path: wikiHumanRawPath(page, pagePathByID),
      contentHash,
      mediaType: "text/markdown",
      capturedAt: toUnixSeconds(page.updatedAt ?? page.createdAt),
      ingestedHash: ingestionByDocId.get(documentId) ?? null,
    });
  }

  const paths = disambiguateRawManifestPaths(manifestEntries);
  paths.sort((a, b) => {
    const aTime = a.capturedAt ?? 0;
    const bTime = b.capturedAt ?? 0;
    return aTime - bTime;
  });

  const manifest: SourcesManifest = { version: 1, documents: paths };
  return Response.json(manifest);
}

function assetRelativePath(path: string, sourceID: string): string {
  const prefix = `raw/${sourceID}/assets/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}
