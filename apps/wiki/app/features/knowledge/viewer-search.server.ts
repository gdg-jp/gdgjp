import { canAccessSource } from "@gdgjp/gdg-lib/acl";
import { inArray } from "drizzle-orm";
import * as schema from "~/db/schema";
import { getEffectivePagePermissions } from "~/features/pages/access.server";
import { getWikiPageUrls } from "~/features/pages/wiki-page-path.server";
import { readableAudienceKeys } from "~/features/sources/audience";
import type { SpaceIdentity } from "~/features/spaces/access.server";
import type { getDb } from "~/lib/db.server";
import { type KnowledgeHit, searchSpaces } from "./search.server";
import type { KnowledgeLayer } from "./shared";

type Db = ReturnType<typeof getDb>;

export type PageResult = {
  pageId: string;
  spaceId: string;
  slug: string;
  titleJa: string;
  titleEn: string;
  summaryJa: string;
  summaryEn: string;
  wikiPath: string;
  url: string;
  origin: string;
  relevanceScore: number;
  matchedChunks: Array<{ text: string; sectionHeading: string | null }>;
};

export type RawResult = {
  documentId: string;
  sourceId: string;
  spaceId: string;
  title: string;
  sourceTitle: string;
  url: string;
  score: number;
  text: string;
};

type Reader = SpaceIdentity & {
  user: (SpaceIdentity["user"] & { email?: string | null; isAdmin?: boolean | null }) | null;
};

/**
 * Search for one reader. `spaceIds` must already be the reader's reachable spaces (outer
 * layer). Audiences come from `readableAudienceKeys` (= canAccessSource); every returned
 * page is re-checked with the page ACL and every raw document with canAccessSource, so the
 * index can never widen what the reader sees.
 */
export async function searchForReader(
  env: Env,
  db: Db,
  reader: Reader,
  input: {
    spaceIds: readonly string[];
    query: string;
    layers?: readonly KnowledgeLayer[];
    maxResults?: number;
    hideAgentPages?: boolean;
    rewrite?: boolean;
  },
): Promise<{ pages: PageResult[]; raw: RawResult[]; excludedPages: number }> {
  const chapters = reader.claimsAvailable ? reader.chapters : [];
  const maxResults = input.maxResults ?? 10;
  const hits = await searchSpaces(env, {
    spaceIds: input.spaceIds,
    audienceKeys: readableAudienceKeys(reader.user, chapters),
    query: input.query,
    layers: input.layers,
    // Post-filters (page ACL, hidden agent pages) drop hits: over-fetch.
    maxResults: Math.min(maxResults * 2, 50),
    rewrite: input.rewrite,
  });
  const [{ pages, excludedPages }, raw] = await Promise.all([
    resolvePageHits(env, db, reader, hits, input.hideAgentPages ?? false),
    resolveRawHits(db, reader, hits),
  ]);
  return { pages: pages.slice(0, maxResults), raw: raw.slice(0, maxResults), excludedPages };
}

async function resolvePageHits(
  env: Env,
  db: Db,
  reader: Reader,
  hits: readonly KnowledgeHit[],
  hideAgentPages: boolean,
): Promise<{ pages: PageResult[]; excludedPages: number }> {
  const pageHits = hits.filter((hit) => hit.pageId);
  const ids = [...new Set(pageHits.map((hit) => hit.pageId as string))];
  if (ids.length === 0) return { pages: [], excludedPages: 0 };
  // Published pages the index matched but this reader may not see: counted, never named.
  const excluded = new Set<string>();
  const rows = await db.select().from(schema.pages).where(inArray(schema.pages.id, ids)).all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const urls = await getWikiPageUrls(env, ids);
  const origin = env.APP_URL.replace(/\/$/, "");
  const results = new Map<string, PageResult>();
  for (const hit of pageHits) {
    const page = byId.get(hit.pageId as string);
    if (!page || page.status !== "published" || page.spaceId !== hit.spaceId) continue;
    if (hideAgentPages && page.origin === "agent") continue;
    const existing = results.get(page.id);
    if (existing) {
      existing.relevanceScore = Math.max(existing.relevanceScore, hit.score);
      existing.matchedChunks.push({ text: hit.text, sectionHeading: null });
      continue;
    }
    const permissions = await getEffectivePagePermissions(
      db,
      page,
      reader.user as never,
      reader.claimsAvailable ? reader.chapters : [],
    );
    if (!permissions.canView) {
      excluded.add(page.id);
      continue;
    }
    const wikiPath = urls.get(page.id) ?? "";
    results.set(page.id, {
      pageId: page.id,
      spaceId: page.spaceId,
      slug: page.slug,
      titleJa: page.titleJa,
      titleEn: page.titleEn,
      summaryJa: page.summaryJa,
      summaryEn: page.summaryEn,
      wikiPath,
      url: `${origin}${wikiPath}`,
      origin: page.origin,
      relevanceScore: hit.score,
      matchedChunks: [{ text: hit.text, sectionHeading: null }],
    });
  }
  return {
    pages: [...results.values()].sort((a, b) => b.relevanceScore - a.relevanceScore),
    excludedPages: excluded.size,
  };
}

async function resolveRawHits(db: Db, reader: Reader, hits: readonly KnowledgeHit[]) {
  const rawHits = hits.filter((hit) => hit.documentId);
  const ids = [...new Set(rawHits.map((hit) => hit.documentId as string))];
  if (ids.length === 0 || !reader.user) return [];
  const docs = await db
    .select({
      id: schema.sourceDocuments.id,
      sourceId: schema.sourceDocuments.sourceId,
      title: schema.sourceDocuments.title,
      status: schema.sourceDocuments.status,
    })
    .from(schema.sourceDocuments)
    .where(inArray(schema.sourceDocuments.id, ids))
    .all();
  const sourceIds = [...new Set(docs.map((doc) => doc.sourceId))];
  const sources =
    sourceIds.length === 0
      ? []
      : await db.select().from(schema.sources).where(inArray(schema.sources.id, sourceIds)).all();
  const docById = new Map(docs.map((doc) => [doc.id, doc]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const out: RawResult[] = [];
  for (const hit of rawHits) {
    const doc = docById.get(hit.documentId as string);
    const source = doc ? sourceById.get(doc.sourceId) : undefined;
    if (!doc || !source || doc.status !== "ready" || source.spaceId !== hit.spaceId) continue;
    const user = reader.user as { id: string; isAdmin?: boolean | null };
    if (
      !canAccessSource(
        source,
        { id: user.id, isAdmin: user.isAdmin ?? false },
        reader.claimsAvailable ? reader.chapters : [],
      )
    ) {
      continue;
    }
    out.push({
      documentId: doc.id,
      sourceId: source.id,
      spaceId: source.spaceId,
      title: doc.title,
      sourceTitle: source.title,
      url: source.url,
      score: hit.score,
      text: hit.text,
    });
  }
  return out;
}
