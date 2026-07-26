import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  type ContentBackfillDatabase,
  backfillMarkdownContent,
  tiptapJsonToMarkdown,
} from "./content-backfill.server";

function createDatabase(): { sqlite: DatabaseSync; d1: ContentBackfillDatabase } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE pages (id TEXT PRIMARY KEY, content_ja TEXT NOT NULL, content_en TEXT NOT NULL);
    CREATE TABLE page_versions (id TEXT PRIMARY KEY, content_ja TEXT NOT NULL, content_en TEXT NOT NULL);
    CREATE TABLE content_backfills (name TEXT PRIMARY KEY, completed_at INTEGER NOT NULL DEFAULT (unixepoch()));
  `);
  const d1: ContentBackfillDatabase = {
    prepare(query) {
      let values: unknown[] = [];
      return {
        bind(...nextValues) {
          values = nextValues;
          return this;
        },
        async all<T>() {
          return { results: sqlite.prepare(query).all(...values) as T[] };
        },
        async first<T>() {
          return (sqlite.prepare(query).get(...values) as T | undefined) ?? null;
        },
        async run() {
          sqlite.prepare(query).run(...values);
        },
      };
    },
    async batch(statements) {
      for (const statement of statements) await statement.run();
    },
  };
  return { sqlite, d1 };
}

const tiptapDocument = JSON.stringify({
  type: "doc",
  content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }],
});

describe("Markdown content backfill", () => {
  it("recognizes only TipTap documents and preserves other JSON and invalid JSON", () => {
    expect(tiptapJsonToMarkdown(tiptapDocument)).toBe("# Title");
    expect(tiptapJsonToMarkdown('{"hello":"world"}')).toBeNull();
    expect(tiptapJsonToMarkdown("{not json")).toBeNull();
    expect(tiptapJsonToMarkdown("# Existing markdown")).toBeNull();
  });

  it("converts pages and version history, without changing Markdown-like JSON", async () => {
    const { sqlite, d1 } = createDatabase();
    const insertPage = sqlite.prepare("INSERT INTO pages VALUES (?, ?, ?)");
    insertPage.run("page-json", tiptapDocument, "# English");
    insertPage.run("page-json-markdown", '{"hello":"world"}', "{not json");
    sqlite
      .prepare("INSERT INTO page_versions VALUES (?, ?, ?)")
      .run("version-json", tiptapDocument, tiptapDocument);

    await expect(backfillMarkdownContent(d1, 1)).resolves.toEqual({
      convertedPages: 1,
      convertedVersions: 1,
      alreadyCompleted: false,
    });
    expect(
      sqlite.prepare("SELECT content_ja, content_en FROM pages WHERE id = 'page-json'").get(),
    ).toEqual({
      content_ja: "# Title",
      content_en: "# English",
    });
    expect(sqlite.prepare("SELECT content_ja, content_en FROM page_versions").get()).toEqual({
      content_ja: "# Title",
      content_en: "# Title",
    });
    expect(
      sqlite
        .prepare("SELECT content_ja, content_en FROM pages WHERE id = 'page-json-markdown'")
        .get(),
    ).toEqual({
      content_ja: '{"hello":"world"}',
      content_en: "{not json",
    });
    await expect(backfillMarkdownContent(d1)).resolves.toEqual({
      convertedPages: 0,
      convertedVersions: 0,
      alreadyCompleted: true,
    });
  });
});
