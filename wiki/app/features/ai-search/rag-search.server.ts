import type { drizzle } from "drizzle-orm/d1";
import { createWikiModel } from "~/features/ai/model/index.server";
import type { AccessContext } from "../../../shared/ingestion/domain";
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

const SEARCH_ANSWER_SYSTEM_PROMPT = `You are a helpful assistant for the GDG Japan Wiki.
Answer only from the supplied, access-controlled evidence. Cite page titles when using information.
If the evidence is insufficient, say so clearly. Respond in the same language as the question using Markdown.`;

/**
 * AI search intentionally remains a normal request/response feature rather
 * than an Agent. Retrieval is bounded and permission-filtered before model
 * invocation, and generation uses the shared provider-neutral model boundary.
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

  const evidence = retrieval.evidence
    .map(
      (item) =>
        `[Page: ${item.title}] (slug: ${item.slug})\n${item.chunks
          .map((chunk) => chunk.text)
          .join("\n\n")}`,
    )
    .join("\n\n---\n\n");
  const answer = await createWikiModel({ apiKey: env.GEMINI_API_KEY }).generateText({
    system: SEARCH_ANSWER_SYSTEM_PROMPT,
    prompt: `## Access-controlled evidence\n\n${evidence}\n\n## Question\n${query}`,
    temperature: 0.3,
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
