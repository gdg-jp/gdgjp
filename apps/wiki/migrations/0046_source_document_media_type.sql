-- Source documents may be Markdown or binary primary material (for example PDFs).
-- Rebuild the table so legacy extension collisions can be resolved before the
-- UNIQUE(source_id, path) constraint is applied to the canonical filenames.
PRAGMA foreign_keys = OFF;

CREATE TABLE "source_documents_replacement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source_id" TEXT NOT NULL REFERENCES "sources"("id") ON DELETE CASCADE,
  "path" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "r2_key" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "media_type" TEXT NOT NULL DEFAULT 'text/markdown',
  "captured_at" INTEGER NOT NULL,
  "cursor" TEXT,
  "metadata" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ready'
    CHECK ("status" IN ('ready', 'error', 'archived')),
  UNIQUE ("source_id", "path")
);

WITH RECURSIVE
"normalized" AS (
  SELECT
    "source_documents".*,
    CASE
      WHEN "path" LIKE '%.md' THEN "path"
      ELSE "path" || '.md'
    END AS "canonical_path",
    CASE WHEN "path" LIKE '%.md' THEN 0 ELSE 1 END AS "canonical_rank"
  FROM "source_documents"
),
"ranked" AS (
  SELECT
    "normalized".*,
    row_number() OVER (
      PARTITION BY "source_id", "canonical_path"
      ORDER BY "canonical_rank", "id"
    ) AS "collision_rank"
  FROM "normalized"
),
"collision_candidates"(
  "id", "source_id", "stem", "suffix", "candidate_path"
) AS (
  SELECT
    "id",
    "source_id",
    substr("canonical_path", 1, length("canonical_path") - 3),
    2,
    substr("canonical_path", 1, length("canonical_path") - 3) || ' (2).md'
  FROM "ranked"
  WHERE "collision_rank" > 1

  UNION ALL

  SELECT
    "collision_candidates"."id",
    "collision_candidates"."source_id",
    "collision_candidates"."stem",
    "collision_candidates"."suffix" + 1,
    "collision_candidates"."stem" || ' (' ||
      ("collision_candidates"."suffix" + 1) || ').md'
  FROM "collision_candidates"
  WHERE EXISTS (
    SELECT 1
    FROM "normalized"
    WHERE "normalized"."source_id" = "collision_candidates"."source_id"
      AND "normalized"."canonical_path" = "collision_candidates"."candidate_path"
  )
),
"resolved_collisions" AS (
  SELECT "id", "candidate_path"
  FROM "collision_candidates"
  WHERE NOT EXISTS (
    SELECT 1
    FROM "normalized"
    WHERE "normalized"."source_id" = "collision_candidates"."source_id"
      AND "normalized"."canonical_path" = "collision_candidates"."candidate_path"
  )
)
INSERT INTO "source_documents_replacement" (
  "id", "source_id", "path", "title", "r2_key", "content_hash",
  "media_type", "captured_at", "cursor", "metadata", "status"
)
SELECT
  "ranked"."id",
  "ranked"."source_id",
  CASE
    WHEN "ranked"."collision_rank" = 1 THEN "ranked"."canonical_path"
    ELSE "resolved_collisions"."candidate_path"
  END,
  "ranked"."title",
  "ranked"."r2_key",
  "ranked"."content_hash",
  'text/markdown',
  "ranked"."captured_at",
  "ranked"."cursor",
  "ranked"."metadata",
  "ranked"."status"
FROM "ranked"
LEFT JOIN "resolved_collisions" ON "resolved_collisions"."id" = "ranked"."id";

DROP TABLE "source_documents";
ALTER TABLE "source_documents_replacement" RENAME TO "source_documents";
CREATE INDEX "idx_source_documents_source_id" ON "source_documents" ("source_id");

PRAGMA foreign_keys = ON;
