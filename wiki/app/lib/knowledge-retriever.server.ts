import { and, eq, inArray, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import type { AccessContext } from "~/lib/agents/contracts";
import { type ContentChunk, chunkPageContent } from "~/lib/chunker.server";
import { canUserSeePageAsync } from "~/lib/page-visibility.server";

type Db = ReturnType<typeof drizzle>;

/** Kept deliberately small so a search result cannot become a hidden full-page export. */
export const KNOWLEDGE_RETRIEVAL_LIMITS = {
  vectorChunks: 50,
  ftsPages: 50,
  pages: 12,
  chunksPerPage: 2,
  rrfK: 60,
} as const;

export type KnowledgeChunk = {
  id: string;
  text: string;
  language: "ja" | "en";
  chunkIndex: number;
  sectionHeading: string | null;
};

/** Evidence is already authorized. Callers must never rehydrate arbitrary page IDs. */
export type KnowledgeEvidence = {
  pageId: string;
  slug: string;
  title: string;
  summary: string;
  ancestorTitles: string[];
  chunks: KnowledgeChunk[];
  score: number;
  sources: Array<"vector" | "fts" | "explicit">;
};

export type KnowledgeSearchInput = {
  query: string;
  access: AccessContext;
  /** Unlisted pages may only enter retrieval through this direct-reference path. */
  explicitPageIds?: readonly string[];
};

export type KnowledgeSearchResult = {
  evidence: KnowledgeEvidence[];
  vectorSearchAvailable: boolean;
};

export interface KnowledgeRetriever {
  search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult>;
}

type VectorHit = {
  pageId: string;
  language: "ja" | "en";
  chunkIndex: number;
  rank: number;
};

type PageMetadata = {
  id: string;
  slug: string;
  titleJa: string;
  titleEn: string;
  summaryJa: string;
  summaryEn: string;
  parentId: string | null;
  visibility: string;
  generalRole: string;
  authorId: string;
};

type PageDocument = PageMetadata & {
  contentJa: string;
  contentEn: string;
};

export type RankedKnowledgePage = {
  pageId: string;
  score: number;
  sources: Set<"vector" | "fts" | "explicit">;
};

function normalizeFtsQuery(query: string): string {
  return query
    .replace(/["'*^():{}[\]<>~@#$&|\\+\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500)
    .split(" ")
    .filter(Boolean)
    .join(" OR ");
}

function parseVectorId(id: string): Omit<VectorHit, "rank"> | null {
  // Embedding IDs are written by embedding-pipeline.server.ts. Splitting from
  // the right also keeps this safe if a future page ID contains a colon.
  const match = /^(.*):(ja|en):(\d+)$/.exec(id);
  if (!match || !match[1]) return null;
  return { pageId: match[1], language: match[2] as "ja" | "en", chunkIndex: Number(match[3]) };
}

/** Reciprocal-rank fusion is exported to keep ranking rules independently testable. */
export function mergeRrfRankings(
  rankings: ReadonlyArray<{ source: "vector" | "fts" | "explicit"; pageIds: readonly string[] }>,
  k: number = KNOWLEDGE_RETRIEVAL_LIMITS.rrfK,
): RankedKnowledgePage[] {
  const merged = new Map<string, RankedKnowledgePage>();
  for (const { source, pageIds } of rankings) {
    const seen = new Set<string>();
    for (let index = 0; index < pageIds.length; index++) {
      const pageId = pageIds[index];
      if (!pageId || seen.has(pageId)) continue;
      seen.add(pageId);
      const result = merged.get(pageId) ?? { pageId, score: 0, sources: new Set() };
      result.score += 1 / (k + index + 1);
      result.sources.add(source);
      merged.set(pageId, result);
    }
  }
  return [...merged.values()].sort((a, b) => {
    // A direct page reference is an explicit user choice. Keep it ahead of
    // discovered evidence (authorization is still checked before hydration).
    const explicitOrder = Number(b.sources.has("explicit")) - Number(a.sources.has("explicit"));
    return explicitOrder || b.score - a.score || a.pageId.localeCompare(b.pageId);
  });
}

function toUser(access: AccessContext) {
  return { id: access.userId, email: access.email, isAdmin: access.isAdmin };
}

async function isAuthorized(
  db: Db,
  access: AccessContext,
  page: Pick<PageMetadata, "id" | "visibility" | "generalRole" | "authorId">,
): Promise<boolean> {
  // Missing live claims must never turn into chapter access. Email/owner/admin
  // grants remain independently verifiable in D1.
  return canUserSeePageAsync(
    db as unknown as Parameters<typeof canUserSeePageAsync>[0],
    toUser(access),
    page,
    access.claimsAvailable ? access.chapterIds : [],
  );
}

async function searchFts(db: Db, query: string): Promise<string[]> {
  const ftsQuery = normalizeFtsQuery(query);
  if (!ftsQuery) return [];
  try {
    const rows = await db.all<{ page_id: string }>(
      sql`SELECT page_id
          FROM pages_fts
          WHERE pages_fts MATCH ${ftsQuery}
          ORDER BY rank
          LIMIT ${KNOWLEDGE_RETRIEVAL_LIMITS.ftsPages}`,
    );
    return rows.map((row) => row.page_id).filter(Boolean);
  } catch (error) {
    // FTS is an optional ranking signal. An empty result is intentionally not
    // replaced with a broad pages query: that was the context-overflow bug.
    console.warn("knowledge-retriever: FTS search unavailable", error);
    return [];
  }
}

async function searchVector(
  env: Env,
  query: string,
): Promise<{ hits: VectorHit[]; available: boolean }> {
  if (!env.AI || !env.VECTORIZE) return { hits: [], available: false };
  try {
    const embeddingResult = await env.AI.run("@cf/baai/bge-m3", { text: [query] });
    const embedding = (embeddingResult as { data?: number[][] }).data?.[0];
    if (!embedding) return { hits: [], available: false };

    // `none` permits topK=50 without depending on optional Vectorize metadata
    // indexes. The stable vector ID contains exactly the chunk reference we need.
    const result = await env.VECTORIZE.query(embedding, {
      topK: KNOWLEDGE_RETRIEVAL_LIMITS.vectorChunks,
      returnMetadata: "none",
    });
    const hits = result.matches.flatMap((match, index) => {
      const parsed = parseVectorId(match.id);
      return parsed ? [{ ...parsed, rank: index + 1 }] : [];
    });
    return { hits, available: true };
  } catch (error) {
    // Vectorize/Workers AI outages fall back to the bounded FTS ranking only.
    console.warn("knowledge-retriever: vector search unavailable", error);
    return { hits: [], available: false };
  }
}

function selectChunks(document: PageDocument, vectorHits: readonly VectorHit[]): KnowledgeChunk[] {
  const allChunks = chunkPageContent({
    pageId: document.id,
    slug: document.slug,
    titleJa: document.titleJa,
    titleEn: document.titleEn,
    summaryJa: document.summaryJa,
    summaryEn: document.summaryEn,
    contentJa: document.contentJa,
    contentEn: document.contentEn,
  });
  const byReference = new Map(
    allChunks.map((chunk) => [`${chunk.language}:${chunk.chunkIndex}`, chunk]),
  );
  const selected: ContentChunk[] = [];
  const used = new Set<string>();
  for (const hit of [...vectorHits].sort((a, b) => a.rank - b.rank)) {
    const key = `${hit.language}:${hit.chunkIndex}`;
    const chunk = byReference.get(key);
    if (chunk && !used.has(key)) {
      selected.push(chunk);
      used.add(key);
    }
    if (selected.length === KNOWLEDGE_RETRIEVAL_LIMITS.chunksPerPage) break;
  }
  // FTS has page-level ranks. Use only two deterministic leading chunks as
  // evidence rather than silently attaching the entire page.
  for (const chunk of allChunks) {
    const key = `${chunk.language}:${chunk.chunkIndex}`;
    if (!used.has(key)) {
      selected.push(chunk);
      used.add(key);
    }
    if (selected.length === KNOWLEDGE_RETRIEVAL_LIMITS.chunksPerPage) break;
  }
  return selected.map((chunk) => ({
    id: `${document.id}:${chunk.language}:${chunk.chunkIndex}`,
    text: chunk.text,
    language: chunk.language,
    chunkIndex: chunk.chunkIndex,
    sectionHeading: chunk.sectionHeading,
  }));
}

async function resolveAncestorTitles(
  db: Db,
  access: AccessContext,
  page: Pick<PageMetadata, "parentId">,
): Promise<string[]> {
  const titles: string[] = [];
  let parentId = page.parentId;
  // A capped walk avoids pathological cycles or unexpectedly deep trees.
  for (let depth = 0; parentId && depth < 8; depth++) {
    const parent = await db
      .select({
        id: schema.pages.id,
        parentId: schema.pages.parentId,
        titleJa: schema.pages.titleJa,
        titleEn: schema.pages.titleEn,
        summaryJa: schema.pages.summaryJa,
        summaryEn: schema.pages.summaryEn,
        slug: schema.pages.slug,
        visibility: schema.pages.visibility,
        generalRole: schema.pages.generalRole,
        authorId: schema.pages.authorId,
      })
      .from(schema.pages)
      .where(and(eq(schema.pages.id, parentId), eq(schema.pages.status, "published")))
      .get();
    if (!parent || parent.visibility === "unlisted" || !(await isAuthorized(db, access, parent)))
      break;
    titles.unshift(parent.titleJa || parent.titleEn);
    parentId = parent.parentId;
  }
  return titles;
}

export class HybridKnowledgeRetriever implements KnowledgeRetriever {
  constructor(
    private readonly env: Env,
    private readonly db: Db,
  ) {}

  async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult> {
    const explicitPageIds = [...new Set(input.explicitPageIds ?? [])].slice(
      0,
      KNOWLEDGE_RETRIEVAL_LIMITS.pages,
    );
    const [vector, ftsPageIds] = await Promise.all([
      searchVector(this.env, input.query),
      searchFts(this.db, input.query),
    ]);
    const vectorPageIds = vector.hits.map((hit) => hit.pageId);
    const ranking = mergeRrfRankings([
      { source: "explicit", pageIds: explicitPageIds },
      { source: "vector", pageIds: vectorPageIds },
      { source: "fts", pageIds: ftsPageIds },
    ]);
    if (ranking.length === 0) return { evidence: [], vectorSearchAvailable: vector.available };

    const rankedIds = ranking.map((item) => item.pageId);
    // Only metadata is read before the D1 permission check. Page bodies are
    // fetched below after authorization, never for an untrusted vector/FTS hit.
    const candidatePages = await this.db
      .select({
        id: schema.pages.id,
        slug: schema.pages.slug,
        titleJa: schema.pages.titleJa,
        titleEn: schema.pages.titleEn,
        summaryJa: schema.pages.summaryJa,
        summaryEn: schema.pages.summaryEn,
        parentId: schema.pages.parentId,
        visibility: schema.pages.visibility,
        generalRole: schema.pages.generalRole,
        authorId: schema.pages.authorId,
      })
      .from(schema.pages)
      .where(and(inArray(schema.pages.id, rankedIds), eq(schema.pages.status, "published")))
      .all();

    const explicitSet = new Set(explicitPageIds);
    const metadataById = new Map(candidatePages.map((page) => [page.id, page]));
    const allowedRanked = [] as RankedKnowledgePage[];
    for (const ranked of ranking) {
      const page = metadataById.get(ranked.pageId);
      if (!page) continue;
      if (page.visibility === "unlisted" && !explicitSet.has(page.id)) continue;
      if (await isAuthorized(this.db, input.access, page)) allowedRanked.push(ranked);
      if (allowedRanked.length === KNOWLEDGE_RETRIEVAL_LIMITS.pages) break;
    }
    if (allowedRanked.length === 0)
      return { evidence: [], vectorSearchAvailable: vector.available };

    const allowedIds = allowedRanked.map((ranked) => ranked.pageId);
    const documents = await this.db
      .select({
        id: schema.pages.id,
        slug: schema.pages.slug,
        titleJa: schema.pages.titleJa,
        titleEn: schema.pages.titleEn,
        summaryJa: schema.pages.summaryJa,
        summaryEn: schema.pages.summaryEn,
        parentId: schema.pages.parentId,
        visibility: schema.pages.visibility,
        generalRole: schema.pages.generalRole,
        authorId: schema.pages.authorId,
        contentJa: schema.pages.contentJa,
        contentEn: schema.pages.contentEn,
      })
      .from(schema.pages)
      .where(and(inArray(schema.pages.id, allowedIds), eq(schema.pages.status, "published")))
      .all();
    const documentsById = new Map(documents.map((page) => [page.id, page]));
    const hitsByPage = new Map<string, VectorHit[]>();
    for (const hit of vector.hits) {
      const hits = hitsByPage.get(hit.pageId) ?? [];
      hits.push(hit);
      hitsByPage.set(hit.pageId, hits);
    }

    const evidence = await Promise.all(
      allowedRanked.flatMap((ranked) => {
        const document = documentsById.get(ranked.pageId);
        if (!document) return [];
        return [
          (async (): Promise<KnowledgeEvidence> => ({
            pageId: document.id,
            slug: document.slug,
            title: document.titleJa || document.titleEn,
            summary: document.summaryJa || document.summaryEn,
            ancestorTitles: await resolveAncestorTitles(this.db, input.access, document),
            chunks: selectChunks(document, hitsByPage.get(document.id) ?? []),
            score: ranked.score,
            sources: [...ranked.sources].sort(),
          }))(),
        ];
      }),
    );
    return { evidence, vectorSearchAvailable: vector.available };
  }
}

export function createKnowledgeRetriever(env: Env, db: Db): KnowledgeRetriever {
  return new HybridKnowledgeRetriever(env, db);
}
