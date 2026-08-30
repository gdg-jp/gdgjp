import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueuePendingTranslations,
  processTranslationMessage,
} from "~/lib/queue-processors.server";

vi.mock("~/features/ai-search/embedding.server", () => ({
  indexPageEmbeddings: vi.fn().mockResolvedValue(undefined),
}));

class TestD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly database: Database.Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: result.changes }, results: [] };
  }

  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.values) as T[] };
  }
}

function testDb(database: Database.Database) {
  return {
    prepare(sql: string) {
      return new TestD1Statement(database, sql);
    },
  };
}

describe("daily translation queue", () => {
  let sqlite: Database.Database;
  let sent: Array<{ pageId: string }>;
  let aiRun: ReturnType<typeof vi.fn>;
  let env: Env;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`
      CREATE TABLE pages (
        id TEXT PRIMARY KEY,
        title_ja TEXT NOT NULL DEFAULT '', title_en TEXT NOT NULL DEFAULT '',
        summary_ja TEXT NOT NULL DEFAULT '', summary_en TEXT NOT NULL DEFAULT '',
        content_ja TEXT NOT NULL DEFAULT '', content_en TEXT NOT NULL DEFAULT '',
        translation_status_en TEXT NOT NULL DEFAULT 'missing',
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
    sqlite.exec(
      readFileSync(new URL("../../migrations/0060_translation_jobs.sql", import.meta.url), "utf8"),
    );
    sent = [];
    aiRun = vi.fn(async (_model: string, input: { text: string }) => ({
      translated_text: input.text
        .replaceAll("題", "Title")
        .replaceAll("概要", "Summary")
        .replaceAll("本文", "Body"),
    }));
    env = {
      AUTO_TRANSLATE: "true",
      TRANSLATION_MODEL_ID: "@cf/meta/m2m100-1.2b",
      TRANSLATION_AI_GATEWAY_ID: "gdgjp-wiki-translation",
      DB: testDb(sqlite),
      AI: { run: aiRun },
      TRANSLATION_QUEUE: {
        send: vi.fn(async (body: { pageId: string }) => {
          sent.push(body);
        }),
      },
    } as unknown as Env;
  });

  afterEach(() => sqlite.close());

  function insertPage(id = "p1") {
    sqlite
      .prepare(
        `INSERT INTO pages(id, title_ja, summary_ja, content_ja, translation_status_en)
         VALUES (?, '題', '概要', '本文', 'missing')`,
      )
      .run(id);
  }

  it("dispatches one coalesced job and ignores duplicate delivery after completion", async () => {
    insertPage();
    sqlite.prepare("UPDATE pages SET content_ja = '本文1' WHERE id = 'p1'").run();
    sqlite.prepare("UPDATE pages SET content_ja = '本文2' WHERE id = 'p1'").run();

    await expect(enqueuePendingTranslations(env)).resolves.toBe(1);
    expect(sent).toEqual([{ pageId: "p1" }]);
    await processTranslationMessage(env, sent[0]);
    const calls = aiRun.mock.calls.length;
    await processTranslationMessage(env, sent[0]);

    expect(aiRun).toHaveBeenCalledTimes(calls);
    expect(
      sqlite.prepare("SELECT status FROM translation_jobs WHERE page_id = 'p1'").get(),
    ).toEqual({
      status: "completed",
    });
    expect(
      sqlite.prepare("SELECT title_en, summary_en, content_en FROM pages WHERE id = 'p1'").get(),
    ).toEqual({ title_en: "Title", summary_en: "Summary", content_en: "Body2" });
  });

  it("discards a stale result when Japanese changes during inference", async () => {
    insertPage();
    await enqueuePendingTranslations(env);
    aiRun.mockImplementationOnce(async (_model: string, input: { text: string }) => {
      sqlite.prepare("UPDATE pages SET content_ja = '更新本文' WHERE id = 'p1'").run();
      return { translated_text: input.text.replaceAll("題", "Old title") };
    });

    await processTranslationMessage(env, { pageId: "p1" });

    expect(
      sqlite.prepare("SELECT status FROM translation_jobs WHERE page_id = 'p1'").get(),
    ).toEqual({
      status: "pending",
    });
    expect(sqlite.prepare("SELECT content_en FROM pages WHERE id = 'p1'").get()).toEqual({
      content_en: "",
    });
  });

  it("defers a spend-limit response until the next UTC allowance", async () => {
    insertPage();
    await enqueuePendingTranslations(env);
    aiRun.mockRejectedValueOnce(new Error("429 AI Gateway spend limit reached"));

    await expect(processTranslationMessage(env, { pageId: "p1" })).resolves.toBeUndefined();
    expect(
      sqlite
        .prepare("SELECT status, next_attempt_at IS NOT NULL AS deferred FROM translation_jobs")
        .get(),
    ).toEqual({ status: "pending", deferred: 1 });
  });

  it("returns an already queued job to pending when the kill switch changes", async () => {
    insertPage();
    await enqueuePendingTranslations(env);
    const disabledEnv = { ...env, AUTO_TRANSLATE: "false" } as unknown as Env;

    await processTranslationMessage(disabledEnv, { pageId: "p1" });

    expect(
      sqlite.prepare("SELECT status FROM translation_jobs WHERE page_id = 'p1'").get(),
    ).toEqual({
      status: "pending",
    });
    expect(aiRun).not.toHaveBeenCalled();
  });
});
