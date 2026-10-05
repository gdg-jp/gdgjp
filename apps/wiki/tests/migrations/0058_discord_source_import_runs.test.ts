import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("0058_discord_source_import_runs migration", () => {
  function openPreMigrationDb() {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE "user" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "chapters" ("id" TEXT PRIMARY KEY);
      INSERT INTO "user" ("id") VALUES ('user-1');
    `);
    db.exec(
      readFileSync(new URL("../../migrations/0033_add_sources.sql", import.meta.url), "utf8"),
    );
    db.exec(
      readFileSync(
        new URL("../../migrations/0035_source_fetch_attempt.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec(
      readFileSync(
        new URL("../../migrations/0045_source_import_runs.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec(
      readFileSync(new URL("../../migrations/0047_source_kinds.sql", import.meta.url), "utf8"),
    );
    db.exec(
      readFileSync(
        new URL("../../migrations/0054_add_source_visibility.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec(
      readFileSync(
        new URL("../../migrations/0056_drop_sources_chapter_fk.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec(
      readFileSync(
        new URL("../../migrations/0057_discord_channel_source.sql", import.meta.url),
        "utf8",
      ),
    );
    return db;
  }

  it("rejects discord-channel runs before the migration and accepts them after", () => {
    const db = openPreMigrationDb();
    db.prepare(
      `INSERT INTO sources (id, kind, url, title, added_by)
       VALUES (?, 'discord-channel', 'https://discord.com/channels/1/2', 'ch', 'user-1')`,
    ).run("src-1");

    expect(() =>
      db
        .prepare(
          `INSERT INTO source_import_runs (id, source_id, kind, fetch_attempt_id)
           VALUES ('run-1', 'src-1', 'discord-channel', 'attempt-1')`,
        )
        .run(),
    ).toThrow(/CHECK/i);

    db.exec(
      readFileSync(
        new URL("../../migrations/0058_discord_source_import_runs.sql", import.meta.url),
        "utf8",
      ),
    );

    db.prepare(
      `INSERT INTO source_import_runs (id, source_id, kind, fetch_attempt_id, phase)
       VALUES ('run-1', 'src-1', 'discord-channel', 'attempt-1', 'listing')`,
    ).run();

    expect(
      db.prepare("SELECT kind, phase FROM source_import_runs WHERE source_id = 'src-1'").get(),
    ).toEqual({ kind: "discord-channel", phase: "listing" });
  });
});
