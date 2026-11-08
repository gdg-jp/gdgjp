import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscordMessage } from "../../../../../app/features/discord/api.server";
import { SubrequestBudget } from "../../subrequest-budget";
import { createSourcesTestDb } from "../../test-db";
import { memorySql } from "../test-do-sql";
import { stepGrouping } from "./finalize";
import { stepListing } from "./listing";
import { type Current, type DiscordImportTickContext, indexMessage } from "./shared";

const { listChannelMessages } = vi.hoisted(() => ({ listChannelMessages: vi.fn() }));
vi.mock("../../../../../app/features/discord/api.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../app/features/discord/api.server")>()),
  listChannelMessages,
}));

const { db, sqlite } = createSourcesTestDb();
const SOURCE_ID = "discord-source-1";

function message(id: string, timestamp: string, content = "hello"): DiscordMessage {
  return {
    id,
    channel_id: "channel-1",
    timestamp,
    content,
    author: { id: "user-1", username: "alice", global_name: "Alice" },
    attachments: [],
  };
}

function context(sql: SqlStorage, budget = 20): DiscordImportTickContext {
  return {
    env: {
      BUCKET: { put: vi.fn().mockResolvedValue(undefined) },
      DISCORD_BOT_TOKEN: "bot",
    } as unknown as Env,
    sql,
    budget: new SubrequestBudget(budget),
    runId: "run-1",
  };
}

function current(sinceCursor: string | null): Current {
  return {
    db,
    source: { id: SOURCE_ID, externalId: "channel-1" },
    run: { sinceCursor, fetchAttemptId: "attempt-1" },
  } as unknown as Current;
}

beforeEach(() => {
  listChannelMessages.mockReset();
  sqlite.exec("DELETE FROM source_documents; DELETE FROM sources;");
  sqlite
    .prepare(
      `INSERT INTO sources (id, kind, url, external_id, title, added_by, status)
       VALUES (?, 'discord-channel', '', 'channel-1', 'Discord', 'user-1', 'fetching')`,
    )
    .run(SOURCE_ID);
});

describe("Discord grouping", () => {
  it("packs quiet weeks into one document and keeps a busy week on its own", async () => {
    const sql = memorySql();
    indexMessage(sql, message("1", "2026-09-01T03:00:00.000Z"));
    indexMessage(sql, message("2", "2026-09-15T03:00:00.000Z"));
    indexMessage(sql, message("3", "2026-10-06T03:00:00.000Z"));
    const busy = Array.from({ length: 600 }, (_, line) => `line ${line}`).join("\n");
    indexMessage(sql, message("4", "2026-10-13T03:00:00.000Z", busy));
    indexMessage(sql, message("5", "2026-10-20T03:00:00.000Z"));

    const ctx = context(sql);
    expect(await stepGrouping(ctx, current(null))).toEqual({ phaseComplete: true });

    expect(
      sql
        .exec<{ week_path: string }>("SELECT week_path FROM week_documents ORDER BY sort_index")
        .toArray()
        .map((row) => row.week_path),
    ).toEqual(["2026-08-31", "2026-10-12", "2026-10-19"]);
    const put = ctx.env.BUCKET.put as ReturnType<typeof vi.fn>;
    const first = JSON.parse(put.mock.calls[0]?.[1] as string) as { messages: DiscordMessage[] };
    expect(first.messages.map((row) => row.id)).toEqual(["1", "2", "3"]);
  });
});

describe("Discord incremental listing", () => {
  it("re-fetches the open document from its first week when there are new messages", async () => {
    sqlite
      .prepare(
        `INSERT INTO source_documents
          (id, source_id, path, title, r2_key, content_hash, captured_at, cursor)
         VALUES ('open', ?, '2026-09-07.md', 'Weeks', 'raw/open', 'hash', unixepoch(), '100')`,
      )
      .run(SOURCE_ID);
    const older = message("100", "2026-09-08T03:00:00.000Z", "older");
    const newer = message("200", "2026-10-20T03:00:00.000Z", "newer");
    listChannelMessages.mockResolvedValueOnce([newer]).mockResolvedValueOnce([older, newer]);

    const sql = memorySql();
    expect(await stepListing(context(sql), current("100"))).toEqual({ phaseComplete: true });

    expect(listChannelMessages.mock.calls[0]?.[2]).toMatchObject({ after: "100" });
    // Monday 2026-09-07 00:00 JST, minus one millisecond, as a snowflake.
    const after = BigInt(listChannelMessages.mock.calls[1]?.[2]?.after as string);
    expect(Number((after >> 22n) + 1420070400000n)).toBe(Date.parse("2026-09-06T15:00:00Z") - 1);
    expect(
      sql
        .exec<{ week_path: string }>("SELECT week_path FROM week_messages ORDER BY create_time")
        .toArray()
        .map((row) => row.week_path),
    ).toEqual(["2026-09-07", "2026-10-19"]);
    expect(
      sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'open_path'").one(),
    ).toEqual({ value: "2026-09-07.md" });
  });

  it("does no more work when the delta is empty", async () => {
    listChannelMessages.mockResolvedValueOnce([]);
    const sql = memorySql();
    expect(await stepListing(context(sql), current("100"))).toEqual({ phaseComplete: true });
    expect(listChannelMessages).toHaveBeenCalledTimes(1);
    expect(
      sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM week_messages").one(),
    ).toEqual({ count: 0 });
  });
});
