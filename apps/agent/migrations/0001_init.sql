-- gdgjp-agent: linked chat accounts, guild / Chat-space ↔ wiki space choices, pending
-- answers and filing idempotency. Replay nonces and PKCE state live in KV (TTL).

CREATE TABLE "account_links" (
  "platform" TEXT NOT NULL CHECK ("platform" IN ('discord', 'google-chat')),
  "chat_user_id" TEXT NOT NULL,
  -- v1 StoredLinkRecord JSON; tokens AES-GCM encrypted with TOKEN_ENCRYPTION_KEYS.
  "record" TEXT NOT NULL,
  "updated_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("platform", "chat_user_id")
);

CREATE TABLE "guild_spaces" (
  "guild_id" TEXT NOT NULL,
  "space_slug" TEXT NOT NULL,
  "granted_by" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("guild_id", "space_slug")
);

CREATE TABLE "chat_spaces" (
  "chat_space" TEXT NOT NULL,
  "space_slug" TEXT NOT NULL,
  "granted_by" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("chat_space", "space_slug")
);

CREATE TABLE "pending_answers" (
  "job_id" TEXT PRIMARY KEY NOT NULL,
  "payload" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'answered', 'degraded')),
  "deadline_at" INTEGER NOT NULL,
  "created_at" INTEGER NOT NULL,
  "settled_at" INTEGER
);
CREATE INDEX "idx_pending_answers_status_deadline" ON "pending_answers" ("status", "deadline_at");

CREATE TABLE "asked_questions" (
  "message_id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch())
);
