import type { KnowledgeChunk, KnowledgeNamespace, KnowledgeSearchRequest } from "./binding";

/** In-memory stand-in for the AI Search namespace binding (tests only). */
export function createFakeKnowledge() {
  const instances = new Map<
    string,
    Map<string, { id: string; body: string; metadata: Record<string, string> }>
  >();
  let nextId = 1;
  const searches: KnowledgeSearchRequest[] = [];
  /** Chunks the next search returns (the fake does not rank text). */
  let nextChunks: KnowledgeChunk[] = [];
  const binding: KnowledgeNamespace = {
    get(id) {
      const items = instances.get(id) ?? new Map();
      instances.set(id, items);
      return {
        items: {
          async upload(name, content, options) {
            const existing = items.get(name);
            const entry = {
              id: existing?.id ?? `item-${nextId++}`,
              body: content,
              metadata: options.metadata,
            };
            items.set(name, entry);
            return { id: entry.id };
          },
          async delete(itemId) {
            for (const [key, value] of items) if (value.id === itemId) items.delete(key);
          },
        },
        async search(request) {
          searches.push(request);
          return { chunks: nextChunks };
        },
      };
    },
    async list() {
      return { result: [...instances.keys()].map((id) => ({ id })) };
    },
    async create(options) {
      instances.set(String(options.id), new Map());
    },
    async delete(id) {
      instances.delete(id);
    },
    async search(request) {
      searches.push(request);
      return { chunks: nextChunks };
    },
  };
  return {
    binding,
    instances,
    searches,
    setNextChunks(chunks: KnowledgeChunk[]) {
      nextChunks = chunks;
    },
  };
}
