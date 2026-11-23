import { knowledgeBinding } from "./binding";
import { DEFAULT_UI_LAYERS, type KnowledgeLayer, PAGE_AUDIENCE, parseItemKey } from "./shared";

export type KnowledgeHit = {
  spaceId: string;
  key: string;
  layer: KnowledgeLayer;
  audience: string;
  score: number;
  text: string;
  pageId?: string;
  documentId?: string;
  sourceId?: string;
  lang?: string;
};

export class KnowledgeSearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeSearchUnavailableError";
  }
}

/** AI Search's namespace search takes 1–10 instances. */
export const MAX_SEARCH_SPACES = 10;

export async function searchSpaces(
  env: Env,
  input: {
    spaceIds: readonly string[];
    audienceKeys: readonly string[] | "all";
    query: string;
    layers?: readonly KnowledgeLayer[];
    maxResults?: number;
    rewrite?: boolean;
  },
): Promise<KnowledgeHit[]> {
  const binding = knowledgeBinding(env);
  if (!binding) throw new KnowledgeSearchUnavailableError("knowledge binding is not configured");
  if (input.spaceIds.length === 0 || !input.query.trim()) return [];
  if (input.spaceIds.length > MAX_SEARCH_SPACES) {
    throw new RangeError(`searchSpaces takes at most ${MAX_SEARCH_SPACES} spaces`);
  }
  const layers = [...(input.layers ?? DEFAULT_UI_LAYERS)];
  const filters: Record<string, unknown> = { layer: { $in: layers } };
  if (input.audienceKeys !== "all") {
    filters.audience = { $in: [...new Set([PAGE_AUDIENCE, ...input.audienceKeys])] };
  }
  const maxResults = Math.min(Math.max(input.maxResults ?? 10, 1), 50);
  let response: Awaited<ReturnType<typeof binding.search>>;
  try {
    // Thresholds are explicit: the 0.4 defaults drop most Japanese matches (scores are low
    // for short documents); ranking still orders them.
    response = await binding.search({
      query: input.query,
      ai_search_options: {
        instance_ids: [...input.spaceIds],
        retrieval: {
          retrieval_type: "hybrid",
          max_num_results: maxResults,
          match_threshold: 0,
          filters,
        },
        reranking: { enabled: true, match_threshold: 0 },
        ...(input.rewrite ? { query_rewrite: { enabled: true } } : {}),
      },
    });
  } catch (error) {
    throw new KnowledgeSearchUnavailableError(
      error instanceof Error ? error.message : String(error),
    );
  }
  if (response.errors?.length && response.chunks.length === 0) {
    throw new KnowledgeSearchUnavailableError(
      response.errors.map((error) => `${error.instance_id}: ${error.message}`).join("; "),
    );
  }
  const hits: KnowledgeHit[] = [];
  for (const chunk of response.chunks) {
    const parsed = parseItemKey(chunk.item.key);
    const meta = chunk.item.metadata ?? {};
    const audience = String(meta.audience ?? "");
    if (!parsed || !layers.includes(parsed.layer)) continue;
    if (input.audienceKeys !== "all" && audience !== PAGE_AUDIENCE) {
      if (!input.audienceKeys.includes(audience)) continue;
    }
    hits.push({
      spaceId: chunk.instance_id ?? input.spaceIds[0] ?? "",
      key: chunk.item.key,
      layer: parsed.layer,
      audience,
      score: chunk.score,
      text: chunk.text,
      ...(parsed.layer === "raw"
        ? { documentId: parsed.documentId, sourceId: String(meta.source_id ?? "") }
        : { pageId: parsed.pageId, lang: parsed.lang }),
    });
  }
  return hits;
}
