import { legacyTiptapToMarkdown } from "~/features/editor/content-format";

const MARKDOWN_CONTENT_BACKFILL = "0028_tiptap_json_to_markdown";
const DEFAULT_BATCH_SIZE = 100;

interface StoredContentRow {
  id: string;
  content_ja: string;
  content_en: string;
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface ContentBackfillDatabase {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}

export interface ContentBackfillResult {
  convertedPages: number;
  convertedVersions: number;
  alreadyCompleted: boolean;
}

export const tiptapJsonToMarkdown = legacyTiptapToMarkdown;

export async function backfillMarkdownContent(
  db: ContentBackfillDatabase,
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<ContentBackfillResult> {
  const completed = await db
    .prepare("SELECT name FROM content_backfills WHERE name = ?")
    .bind(MARKDOWN_CONTENT_BACKFILL)
    .first<{ name: string }>();
  if (completed) return { convertedPages: 0, convertedVersions: 0, alreadyCompleted: true };

  const convertedPages = await backfillTable(db, "pages", batchSize);
  const convertedVersions = await backfillTable(db, "page_versions", batchSize);
  await db
    .prepare("INSERT OR IGNORE INTO content_backfills (name) VALUES (?)")
    .bind(MARKDOWN_CONTENT_BACKFILL)
    .run();

  return { convertedPages, convertedVersions, alreadyCompleted: false };
}

async function backfillTable(
  db: ContentBackfillDatabase,
  table: "pages" | "page_versions",
  batchSize: number,
): Promise<number> {
  let converted = 0;
  let afterId = "";

  for (;;) {
    const { results } = await db
      .prepare(
        `SELECT id, content_ja, content_en FROM ${table}
         WHERE id > ? AND (json_valid(content_ja) OR json_valid(content_en))
         ORDER BY id LIMIT ?`,
      )
      .bind(afterId, batchSize)
      .all<StoredContentRow>();
    if (results.length === 0) return converted;

    afterId = results.at(-1)?.id ?? afterId;
    const updates = results.flatMap((row) => {
      const contentJa = legacyTiptapToMarkdown(row.content_ja);
      const contentEn = legacyTiptapToMarkdown(row.content_en);
      if (contentJa === null && contentEn === null) return [];

      const setters: string[] = [];
      const values: unknown[] = [];
      if (contentJa !== null) {
        setters.push("content_ja = ?");
        values.push(contentJa);
      }
      if (contentEn !== null) {
        setters.push("content_en = ?");
        values.push(contentEn);
      }
      converted += 1;
      return [
        db
          .prepare(`UPDATE ${table} SET ${setters.join(", ")} WHERE id = ?`)
          .bind(...values, row.id),
      ];
    });
    if (updates.length > 0) await db.batch(updates);
    if (results.length < batchSize) return converted;
  }
}
