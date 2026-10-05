import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("0028_markdown_content_backfill migration", () => {
  it("creates the durable backfill completion marker", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      readFileSync(
        new URL("../../migrations/0028_markdown_content_backfill.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(db.prepare("PRAGMA table_info(content_backfills)").all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "name" })]),
    );
  });
});
