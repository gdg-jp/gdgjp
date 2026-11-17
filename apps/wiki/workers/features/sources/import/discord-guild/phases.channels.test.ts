import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubrequestBudget } from "../../subrequest-budget";
import { createSourcesTestDb } from "../../test-db";
import type { Current, DiscordImportTickContext } from "../discord/shared";
import { metaGet } from "../run";
import { memorySql } from "../test-do-sql";
import { discordGuildImportDriver } from "./phases";

const { listChannelMessages } = vi.hoisted(() => ({ listChannelMessages: vi.fn() }));
vi.mock("../../../../../app/features/discord/api.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../app/features/discord/api.server")>()),
  listChannelMessages,
}));

const { db, sqlite } = createSourcesTestDb();
const SOURCE_ID = "discord-guild-1";

function context(sql: SqlStorage): DiscordImportTickContext {
  return {
    env: {
      BUCKET: {
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      DISCORD_BOT_TOKEN: "bot",
    } as unknown as Env,
    sql,
    budget: new SubrequestBudget(200),
    runId: "run-1",
  };
}

const current = {
  db,
  source: { id: SOURCE_ID, externalId: "guild-1", config: null },
  run: { sinceCursor: null, fetchAttemptId: "attempt-1" },
} as unknown as Current;

beforeEach(() => {
  listChannelMessages.mockReset();
  sqlite.exec("DELETE FROM source_documents; DELETE FROM sources;");
  sqlite
    .prepare(
      `INSERT INTO sources (id, kind, url, external_id, title, added_by, status)
       VALUES (?, 'discord-guild', '', 'guild-1', 'Discord', 'user-1', 'fetching')`,
    )
    .run(SOURCE_ID);
});

describe("Discord server import", () => {
  it("skips a channel the bot cannot read and imports the rest", async () => {
    const sql = memorySql();
    const ctx = context(sql);
    // Creates the guild tables; no channels yet.
    await discordGuildImportDriver.step("channels", ctx, current);
    sql.exec(
      "INSERT INTO guild_channels (idx, channel_id, name, category_name) VALUES (0, 'private', 'staff-only', NULL), (1, 'general', 'general', NULL)",
    );
    sql.exec("DELETE FROM meta WHERE key = 'guild_channel_index'");
    listChannelMessages.mockImplementation(async (_token: string, channelId: string) => {
      if (channelId === "private") {
        throw Object.assign(new Error("Discord channel messages unavailable (403)"), {
          code: "bot_missing",
        });
      }
      return [];
    });

    const outcome = await discordGuildImportDriver.step("channels", ctx, current);

    expect(outcome.phaseComplete).toBe(true);
    expect(metaGet(sql, "guild_channel_index")).toBe("2");
    expect(listChannelMessages.mock.calls.map((call) => call[1])).toContain("general");
  });
});
