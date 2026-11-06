-- Knowledge platform v2 Stage 04: the OCI runner.
-- (ADD COLUMN / CREATE TABLE only — no table rebuilds; see memory on D1 cascades.)

-- The runner writes pages as this identity (author / last_edited_by of agent pages).
INSERT INTO "user" ("id", "email", "name", "created_at", "updated_at")
VALUES ('runner', 'runner@wiki.gdgs.jp', 'Knowledge Runner', unixepoch(), unixepoch())
ON CONFLICT ("id") DO NOTHING;

-- One row per runner host: liveness for /admin/runner and the degraded-answer decision.
CREATE TABLE "runner_status" (
  "host"           TEXT NOT NULL PRIMARY KEY,
  "version"        TEXT NOT NULL DEFAULT '',
  "backend"        TEXT NOT NULL DEFAULT '',
  "last_seen_at"   INTEGER NOT NULL DEFAULT (unixepoch()),
  "running_job_id" TEXT,
  "alerted_at"     INTEGER
);

-- content_ja hash the current English translation was made from (NULL = never translated
-- by the runner). translate jobs are queued only when it differs from the current hash.
ALTER TABLE "pages" ADD COLUMN "translation_source_hash" TEXT;
