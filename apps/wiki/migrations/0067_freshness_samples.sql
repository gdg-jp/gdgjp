-- Stage 06: nightly latency samples, so operators can tell from the wiki alone whether
-- AI Search (freshness), the runner (integration) or answering is slow.
CREATE TABLE "freshness_samples" (
  "id" TEXT PRIMARY KEY NOT NULL,
  -- 'freshness' | 'integration' | 'answer' | 'answer_expired'
  "kind" TEXT NOT NULL,
  "space_id" TEXT,
  "value_seconds" INTEGER NOT NULL,
  "subject_id" TEXT,
  "sampled_at" INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX "idx_freshness_samples_kind_time" ON "freshness_samples" ("kind", "sampled_at");
