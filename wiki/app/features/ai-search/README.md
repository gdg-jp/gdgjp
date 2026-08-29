# ai-search

Semantic page search: Workers AI `bge-m3` embeddings (1024-dim) + the `gdgjp-wiki-pages`
Vectorize index. Independent of wiki generation — generation never touches Vectorize.

Entry points:

- `rag-search.server.ts` — query-time retrieval + answer synthesis (`/search`).
- `knowledge-retriever.server.ts` — ACL-filtered vector retrieval.
- `chunker.server.ts` / `embedding.server.ts` — index-time chunking and embedding.
