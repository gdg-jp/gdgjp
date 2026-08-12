import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "../../../app/db/schema";

/**
 * A real SQLite database driven through Drizzle's proxy driver, seeded from the
 * checked-in migration.
 *
 * The source lifecycle rules this exercises live entirely in WHERE clauses — "only
 * finish if the row is still fetching", "archive the paths this fetch did not return".
 * Mocking the query builder would assert that we wrote the code we wrote; running the
 * statements asserts they select the rows we meant.
 */
export function createSourcesTestDb() {
  const sqlite = new DatabaseSync(":memory:");
  let afterExecute:
    | ((sql: string, params: unknown[], method: "run" | "all" | "values" | "get") => void)
    | undefined;
  sqlite.exec(`
    CREATE TABLE "user" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "chapters" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "google_drive_tokens" (
      "user_id" TEXT NOT NULL PRIMARY KEY,
      "access_token" TEXT NOT NULL,
      "refresh_token" TEXT,
      "expires_at" INTEGER NOT NULL,
      "updated_at" INTEGER NOT NULL DEFAULT (unixepoch())
    );
    INSERT INTO "user" ("id") VALUES ('user-1');
  `);
  sqlite.exec(
    readFileSync(new URL("../../../migrations/0033_add_sources.sql", import.meta.url), "utf8"),
  );
  sqlite.exec(
    readFileSync(
      new URL("../../../migrations/0034_google_chat_ingestion.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../../../migrations/0035_source_fetch_attempt.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../../../migrations/0040_google_chat_import_runs.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../../../migrations/0042_google_chat_import_do.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../../../migrations/0045_source_import_runs.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../../../migrations/0046_source_document_media_type.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(new URL("../../../migrations/0047_source_kinds.sql", import.meta.url), "utf8"),
  );
  sqlite.exec(
    readFileSync(
      new URL("../../../migrations/0049_google_chat_sender_registry.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../../../migrations/0051_drop_google_chat_document_renders.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../../../migrations/0054_add_source_visibility.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../../../migrations/0056_drop_sources_chapter_fk.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../../../migrations/0057_discord_channel_source.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../../../migrations/0058_discord_source_import_runs.sql", import.meta.url),
      "utf8",
    ),
  );

  const execute = async (
    sql: string,
    params: unknown[],
    method: "run" | "all" | "values" | "get",
  ) => {
    const statement = sqlite.prepare(sql);
    if (method === "run") {
      const result = statement.run(...(params as never[]));
      afterExecute?.(sql, params, method);
      return { rows: [], meta: { changes: result.changes } };
    }
    // The proxy driver wants positional values, not column-keyed objects. For `get`
    // it wants the single row itself, and `undefined` — not `[]` — when there is none;
    // an empty array maps to an all-undefined object that reads as a real row.
    const rows = statement.all(...(params as never[])).map((row) => Object.values(row));
    afterExecute?.(sql, params, method);
    if (method === "get") {
      return { rows: rows[0] as unknown[] } as { rows: unknown[] };
    }
    return { rows };
  };

  const db = drizzle(
    execute,
    async (batch) => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const query of batch) {
          results.push(await execute(query.sql, query.params, query.method));
        }
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    { schema },
  );

  return {
    db,
    sqlite,
    setAfterExecute(callback: typeof afterExecute) {
      afterExecute = callback;
    },
  };
}

export type SourcesTestDb = ReturnType<typeof createSourcesTestDb>;
