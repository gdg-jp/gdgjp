/**
 * The slice of the AI Search namespace binding this app uses (built-in storage instances,
 * Items API, filtered search). Narrow on purpose: tests provide a fake with this shape.
 */
export type KnowledgeChunk = {
  id: string;
  score: number;
  text: string;
  instance_id?: string;
  item: { key: string; timestamp?: number; metadata?: Record<string, unknown> };
};

export type KnowledgeSearchRequest = {
  query: string;
  ai_search_options: {
    instance_ids?: string[];
    retrieval: {
      retrieval_type: "hybrid" | "vector" | "keyword";
      max_num_results: number;
      match_threshold: number;
      filters: Record<string, unknown>;
    };
    reranking?: { enabled: boolean; match_threshold: number };
    query_rewrite?: { enabled: boolean };
  };
};

export interface KnowledgeInstance {
  items: {
    upload(
      name: string,
      content: string,
      options: { metadata: Record<string, string> },
    ): Promise<{ id: string }>;
    delete(itemId: string): Promise<void>;
  };
  search(request: KnowledgeSearchRequest): Promise<{ chunks: KnowledgeChunk[] }>;
}

export interface KnowledgeNamespace {
  get(id: string): KnowledgeInstance;
  list(options?: { page?: number; per_page?: number }): Promise<{
    result: Array<{ id: string }>;
    result_info?: { total_count?: number };
  }>;
  create(options: Record<string, unknown>): Promise<unknown>;
  delete(id: string): Promise<void>;
  search(request: KnowledgeSearchRequest): Promise<{
    chunks: KnowledgeChunk[];
    errors?: Array<{ instance_id: string; message: string }>;
  }>;
}

export function knowledgeBinding(env: Env): KnowledgeNamespace | null {
  const binding = (env as unknown as { KNOWLEDGE?: KnowledgeNamespace }).KNOWLEDGE;
  return binding ?? null;
}
