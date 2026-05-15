import { GoogleGenAI } from "@google/genai";
import { type SQL, and, eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { chunkPageContent } from "./chunker.server";

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

const RAG_UNAVAILABLE: RagSearchResult = { answer: "", sources: [], ragAvailable: false };

export async function performRagSearch(
  env: Env,
  db: Db,
  query: string,
  visFilter: SQL | undefined,
): Promise<RagSearchResult> {
  if (!env.VECTORIZE || !env.AI) {
    return RAG_UNAVAILABLE;
  }

  // 1. Embed the query
  const embedResult = await env.AI.run("@cf/baai/bge-m3", { text: [query] });
  const embedData = (embedResult as { data?: number[][] }).data ?? [];
  const queryEmbedding = embedData[0];
  if (!queryEmbedding) {
    return RAG_UNAVAILABLE;
  }

  // 2. Vector search
  const vectorResults = await env.VECTORIZE.query(queryEmbedding, {
    topK: 20,
    returnMetadata: "all",
  });

  if (!vectorResults.matches || vectorResults.matches.length === 0) {
    return { answer: "", sources: [], ragAvailable: true };
  }

  // 3. Group by pageId, take top unique pages
  const pageChunks = new Map<
    string,
    {
      score: number;
      chunks: Array<{ chunkIndex: number; language: string; sectionHeading: string | null }>;
    }
  >();

  for (const match of vectorResults.matches) {
    const meta = match.metadata as Record<string, unknown> | undefined;
    if (!meta) continue;
    const pageId = meta.pageId as string;
    const sectionHeading = (meta.sectionHeading as string) || null;
    const chunkIndex = typeof meta.chunkIndex === "number" ? meta.chunkIndex : -1;
    const language = (meta.language as string) || "en";
    const existing = pageChunks.get(pageId) ?? { score: 0, chunks: [] };
    existing.score = Math.max(existing.score, match.score);
    existing.chunks.push({ chunkIndex, language, sectionHeading });
    pageChunks.set(pageId, existing);
  }

  const topPageIds = [...pageChunks.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 8)
    .map(([id]) => id);

  if (topPageIds.length === 0) {
    return { answer: "", sources: [], ragAvailable: true };
  }

  // 4. Fetch page metadata from D1, apply visibility filter
  const conditions = [inArray(schema.pages.id, topPageIds), eq(schema.pages.status, "published")];
  if (visFilter) conditions.push(visFilter);

  const pages = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      summaryJa: schema.pages.summaryJa,
      summaryEn: schema.pages.summaryEn,
      contentJa: schema.pages.contentJa,
      contentEn: schema.pages.contentEn,
    })
    .from(schema.pages)
    .where(and(...conditions))
    .all();

  if (pages.length === 0) {
    return { answer: "", sources: [], ragAvailable: true };
  }

  // Build a lookup: pageId -> Map<"lang:chunkIndex", chunkText>
  const chunkTextMap = new Map<string, Map<string, string>>();
  for (const p of pages) {
    const chunks = chunkPageContent({
      pageId: p.id,
      slug: p.slug,
      titleJa: p.titleJa,
      titleEn: p.titleEn,
      summaryJa: p.summaryJa,
      summaryEn: p.summaryEn,
      contentJa: p.contentJa,
      contentEn: p.contentEn,
    });
    const map = new Map<string, string>();
    for (const chunk of chunks) {
      map.set(`${chunk.language}:${chunk.chunkIndex}`, chunk.text);
    }
    chunkTextMap.set(p.id, map);
  }

  // Build context excerpts for Gemini (use summaries + first 500 chars of content)
  const contextExcerpts = pages.map((p) => {
    const titleJa = p.titleJa || "";
    const titleEn = p.titleEn || "";
    const summary = p.summaryJa || p.summaryEn || "";
    // Use a brief excerpt from content for context
    const contentPreview = (p.contentJa || p.contentEn || "").slice(0, 500);
    return `[Page: ${titleJa} / ${titleEn}] (slug: ${p.slug})\nSummary: ${summary}\nContent excerpt: ${contentPreview}`;
  });

  // 5. Gemini answer synthesis
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  const systemPrompt = `You are a helpful assistant for the GDGoC Japan Wiki.
Answer the user's question based ONLY on the wiki page excerpts provided below.
Cite pages by their title when referencing information.
If the provided excerpts do not contain enough information to answer, say so clearly.
Respond in the same language as the user's query.
Use markdown formatting for your answer.`;

  const userPrompt = `## Wiki Page Excerpts

${contextExcerpts.join("\n\n---\n\n")}

---

## User Question
${query}

Please answer based only on the wiki excerpts above.`;

  let answer = "";
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.3,
      },
    });
    answer = response.text ?? "";
  } catch (err) {
    console.error("rag-search: Gemini answer synthesis failed", err);
    answer = "";
  }

  // 6. Build sources
  const sources = pages.map((p) => {
    const chunkRefs = pageChunks.get(p.id)?.chunks ?? [];
    const pageChunkMap = chunkTextMap.get(p.id) ?? new Map<string, string>();
    const matchedChunks = chunkRefs.map((ref) => ({
      text: pageChunkMap.get(`${ref.language}:${ref.chunkIndex}`) ?? "",
      sectionHeading: ref.sectionHeading,
    }));
    return {
      pageId: p.id,
      slug: p.slug,
      titleJa: p.titleJa,
      titleEn: p.titleEn,
      summaryJa: p.summaryJa,
      summaryEn: p.summaryEn,
      relevanceScore: pageChunks.get(p.id)?.score ?? 0,
      matchedChunks,
    };
  });

  // Sort by relevance
  sources.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return { answer, sources, ragAvailable: true };
}
