-- Stage 05: short-lived tokens that let the runner's MCP tools read the wiki AS THE ASKER
-- of one `answer` job. Valid only on /api/agent/{knowledge-search,page}; 10-minute TTL;
-- revoked when the job finishes. Only the hash is stored.
CREATE TABLE "job_tokens" (
  "token_hash" TEXT PRIMARY KEY NOT NULL,
  "job_id" TEXT NOT NULL REFERENCES "agent_jobs" ("id") ON DELETE CASCADE,
  -- JSON: { identity, extraPrincipals } snapshot of the asker at enqueue time.
  "principal" TEXT NOT NULL,
  "expires_at" INTEGER NOT NULL,
  "revoked_at" INTEGER,
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX "idx_job_tokens_job" ON "job_tokens" ("job_id");
