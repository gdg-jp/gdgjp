import type { drizzle } from "drizzle-orm/d1";
import type { AccessContext } from "./agents/contracts";
import { createGeminiGenerationProvider } from "./gemini/gemini-generation-provider.server";
import { createKnowledgeRetriever } from "./knowledge-retriever.server";

type Db = ReturnType<typeof drizzle>;

export interface RagSearchResult {
  answer: string;
  sources: Array<{
    pageId: string;
    slug: string;
    titleJa: string;
    titleEn: string;
    summaryJa: string;
    summaryEn: string;
    relevanceScore: number;
    matchedChunks: Array<{ text: string; sectionHeading: string | null }>;
  }>;
  ragAvailable: boolean;
}

/**
 * Synchronous UI adapter over the same permission-aware retriever and model
 * provider used by ingestion. The result shape remains compatible with the
 * existing search page while retrieval implementations stay replaceable.
 */
export async function performRagSearch(
  env: Env,
  db: Db,
  query: string,
  access: AccessContext,
): Promise<RagSearchResult> {
  const retrieval = await createKnowledgeRetriever(env, db).search({ query, access });
  if (retrieval.evidence.length === 0) {
    return { answer: "", sources: [], ragAvailable: true };
  }

  const answer = await createGeminiGenerationProvider(env.GEMINI_API_KEY).answerSearch({
    query,
    evidence: retrieval.evidence.map((item) => ({
      title: item.title,
      slug: item.slug,
      chunks: item.chunks.map((chunk) => chunk.text),
    })),
  });

  return {
    answer,
    ragAvailable: true,
    sources: retrieval.evidence.map((item) => ({
      pageId: item.pageId,
      slug: item.slug,
      titleJa: item.title,
      titleEn: "",
      summaryJa: item.summary,
      summaryEn: "",
      relevanceScore: item.score,
      matchedChunks: item.chunks.map((chunk) => ({
        text: chunk.text,
        sectionHeading: chunk.sectionHeading,
      })),
    })),
  };
}
