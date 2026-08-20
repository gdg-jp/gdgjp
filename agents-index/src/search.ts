import { canSearchChunk } from "./acl/filter.ts";
import type { SourceMetadata } from "./acl/frontmatter.ts";
import type { ResolvedPrincipal } from "./authz.ts";
import type { Embedder } from "./indexer/embed.ts";
import type { IndexStore } from "./indexer/store.ts";

export type SearchResult = { path: string; startLine: number; endLine: number; score: number };

export async function searchIndex(input: {
  store: IndexStore;
  embedder: Embedder;
  sourceMetadata: ReadonlyMap<string, SourceMetadata>;
  principal: ResolvedPrincipal | null;
  query: string;
  limit?: number;
  pathPrefix?: string;
  maxScanned?: number;
  timeoutMs?: number;
}): Promise<SearchResult[]> {
  if (!input.principal) return [];
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
  const maxScanned = Number(process.env.INDEX_MAX_SCANNED ?? input.maxScanned ?? 1_000);
  const timeoutMs = Number(process.env.INDEX_SEARCH_TIMEOUT_MS ?? input.timeoutMs ?? 2_000);
  const embedding = await input.embedder.embed(input.query, true);
  const result: SearchResult[] = [];
  const started = performance.now();
  let offset = 0;
  while (result.length < limit && offset < maxScanned && performance.now() - started < timeoutMs) {
    const pageSize = Math.min(100, maxScanned - offset);
    const page = input.store.search(embedding, offset, pageSize);
    if (page.length === 0) break;
    offset += page.length;
    for (const candidate of page) {
      if (
        (!input.pathPrefix || candidate.path.startsWith(input.pathPrefix)) &&
        canSearchChunk(candidate, input.sourceMetadata, input.principal)
      ) {
        result.push({
          path: candidate.path,
          startLine: candidate.startLine,
          endLine: candidate.endLine,
          score: 1 / (1 + candidate.distance),
        });
        if (result.length === limit) break;
      }
    }
  }
  return result;
}
