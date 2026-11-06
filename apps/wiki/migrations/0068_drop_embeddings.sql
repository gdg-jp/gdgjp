-- Stage 07: Vectorize page embeddings are gone (search is AI Search, app/features/knowledge).
-- Drop the pages triggers that fed the queue first, or every page write would fail.
-- page_embedding_status is a leaf child of pages: dropping it touches no other table.
DROP TRIGGER IF EXISTS "trg_page_embedding_insert";
DROP TRIGGER IF EXISTS "trg_page_embedding_update";
DROP TABLE IF EXISTS "page_embedding_status";
