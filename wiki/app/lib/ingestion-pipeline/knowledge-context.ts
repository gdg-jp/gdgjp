import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { type AccessContext, createAccessContext } from "~/lib/agents/contracts";
import type { PageIndexEntry } from "~/lib/gemini.server";
import { createGeminiGenerationProvider } from "~/lib/gemini/gemini-generation-provider.server";
import { PHASE1_SYSTEM_PROMPT, PROMPT_VERSIONS } from "~/lib/gemini/prompts";
import { SourceContextTooLargeError, getAvailableInputTokens } from "~/lib/gemini/token-budget";
import { type KnowledgeEvidence, createKnowledgeRetriever } from "~/lib/knowledge-retriever.server";

type Db = ReturnType<typeof drizzle>;
const CONTEXT_WINDOW_TOKENS = 100_000;
const OUTPUT_RESERVE_TOKENS = 8_000;

function parseAccessContext(value: string | null): AccessContext | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as AccessContext;
    if (parsed && typeof parsed.userId === "string" && Array.isArray(parsed.chapterIds)) {
      return parsed;
    }
  } catch {
    // Fall through to the fail-closed D1 identity below.
  }
  return null;
}

function toPageIndexEntry(evidence: KnowledgeEvidence): PageIndexEntry {
  const excerpt = evidence.chunks
    .map((chunk) => chunk.text)
    .join("\n\n")
    .slice(0, 6_000);
  return {
    id: evidence.pageId,
    title: evidence.title,
    summary: [
      evidence.summary,
      evidence.ancestorTitles.length > 0 && `祖先: ${evidence.ancestorTitles.join(" > ")}`,
      excerpt && `関連箇所:\n${excerpt}`,
    ]
      .filter(Boolean)
      .join("\n"),
    slug: evidence.slug,
    parentId: null,
  };
}

function buildTokenContents(
  userText: string,
  files: { uri: string; mimeType: string }[],
  pageIndex: PageIndexEntry[],
) {
  return [
    {
      role: "user" as const,
      parts: [
        { text: userText },
        ...files.map((file) => ({ fileData: { fileUri: file.uri, mimeType: file.mimeType } })),
        { text: JSON.stringify(pageIndex) },
      ],
    },
  ];
}

export async function buildKnowledgeContext(params: {
  env: Env;
  db: Db;
  sessionId: string;
  userText: string;
  files: { uri: string; mimeType: string }[];
}): Promise<PageIndexEntry[]> {
  const { env, db, sessionId, userText, files } = params;
  const session = await db
    .select({
      accessContextJson: schema.ingestionSessions.accessContextJson,
      contextManifestJson: schema.ingestionSessions.contextManifestJson,
      userId: schema.ingestionSessions.userId,
    })
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, sessionId))
    .get();
  if (!session) throw new Error("Ingestion session not found while building knowledge context");

  let access = parseAccessContext(session.accessContextJson);
  if (!access) {
    const user = await db
      .select({ email: schema.user.email, isAdmin: schema.user.isAdmin })
      .from(schema.user)
      .where(eq(schema.user.id, session.userId))
      .get();
    access = createAccessContext({
      userId: session.userId,
      email: user?.email,
      isAdmin: user?.isAdmin,
      chapterIds: [],
      claimsAvailable: false,
      source: "system",
    });
  }

  const search = await createKnowledgeRetriever(env, db).search({ query: userText, access });
  const provider = createGeminiGenerationProvider(env.GEMINI_API_KEY);
  const availableTokens = getAvailableInputTokens({
    contextWindowTokens: CONTEXT_WINDOW_TOKENS,
    outputReserveTokens: OUTPUT_RESERVE_TOKENS,
  });
  const base = await provider.countTokens({
    contents: buildTokenContents(userText, files, []),
    systemInstruction: PHASE1_SYSTEM_PROMPT,
  });
  if (base.inputTokens > availableTokens) {
    throw new SourceContextTooLargeError(base.inputTokens, availableTokens);
  }

  const selected: PageIndexEntry[] = [];
  let inputTokens = base.inputTokens;
  for (const evidence of search.evidence) {
    const candidate = [...selected, toPageIndexEntry(evidence)];
    const count = await provider.countTokens({
      contents: buildTokenContents(userText, files, candidate),
      systemInstruction: PHASE1_SYSTEM_PROMPT,
    });
    if (count.inputTokens <= availableTokens) {
      selected.push(candidate.at(-1) as PageIndexEntry);
      inputTokens = count.inputTokens;
    }
  }

  let manifest: Record<string, unknown> = {};
  try {
    manifest = session.contextManifestJson ? JSON.parse(session.contextManifestJson) : {};
  } catch {
    manifest = {};
  }
  manifest.retrieval = {
    model: provider.model,
    promptVersion: PROMPT_VERSIONS.planner,
    inputTokens,
    availableTokens,
    vectorSearchAvailable: search.vectorSearchAvailable,
    pages: search.evidence
      .filter((evidence) => selected.some((page) => page.id === evidence.pageId))
      .map((evidence) => ({
        pageId: evidence.pageId,
        chunkIds: evidence.chunks.map((chunk) => chunk.id),
        score: evidence.score,
        sources: evidence.sources,
      })),
  };
  await db
    .update(schema.ingestionSessions)
    .set({ contextManifestJson: JSON.stringify(manifest), updatedAt: new Date() })
    .where(eq(schema.ingestionSessions.id, sessionId));
  console.log(
    JSON.stringify({
      component: "knowledge-context",
      event: "retrieval_complete",
      sessionId,
      candidates: search.evidence.length,
      selected: selected.length,
      inputTokens,
      vectorSearchAvailable: search.vectorSearchAvailable,
    }),
  );
  return selected;
}
