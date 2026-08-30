import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("0060_translation_jobs migration", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE pages (
        id TEXT PRIMARY KEY,
        title_ja TEXT NOT NULL DEFAULT '',
        summary_ja TEXT NOT NULL DEFAULT '',
        content_ja TEXT NOT NULL DEFAULT '',
        translation_status_en TEXT NOT NULL DEFAULT 'missing'
      );
      INSERT INTO pages VALUES ('missing', '題', '概要', '本文', 'missing');
      INSERT INTO pages VALUES ('translated', '題', '概要', '本文', 'ai');
      INSERT INTO pages VALUES ('human', '題', '概要', '本文', 'human');
    `);
    db.exec(
      readFileSync(new URL("../../migrations/0060_translation_jobs.sql", import.meta.url), "utf8"),
    );
  });

  afterEach(() => db.close());

  it("backfills missing English only", () => {
    expect(db.prepare("SELECT page_id FROM translation_jobs ORDER BY page_id").all()).toEqual([
      { page_id: "missing" },
    ]);
  });

  it("coalesces repeated Japanese changes and invalidates an active lease", () => {
    db.prepare(
      `UPDATE translation_jobs SET status = 'processing', source_hash = 'old', lease_until = 9999999999
       WHERE page_id = 'missing'`,
    ).run();
    db.prepare("UPDATE pages SET content_ja = '更新1' WHERE id = 'missing'").run();
    db.prepare("UPDATE pages SET content_ja = '更新2' WHERE id = 'missing'").run();

    expect(
      db.prepare("SELECT * FROM translation_jobs WHERE page_id = 'missing'").get(),
    ).toMatchObject({
      page_id: "missing",
      status: "pending",
      source_hash: null,
      lease_until: null,
      attempts: 0,
    });
    expect(db.prepare("SELECT count(*) AS count FROM translation_jobs").get()).toEqual({
      count: 1,
    });
  });

  it("marks AI English stale but never schedules over human English", () => {
    db.prepare("UPDATE pages SET content_ja = '更新' WHERE id = 'translated'").run();
    db.prepare("UPDATE pages SET content_ja = '人手更新' WHERE id = 'human'").run();

    expect(
      db.prepare("SELECT translation_status_en FROM pages WHERE id = 'translated'").get(),
    ).toEqual({ translation_status_en: "missing" });
    expect(
      db.prepare("SELECT status FROM translation_jobs WHERE page_id = 'translated'").get(),
    ).toEqual({ status: "pending" });
    expect(
      db.prepare("SELECT status FROM translation_jobs WHERE page_id = 'human'").get(),
    ).toBeUndefined();
  });

  it("schedules a page when human English is deliberately cleared", () => {
    db.prepare("UPDATE pages SET translation_status_en = 'missing' WHERE id = 'human'").run();
    expect(db.prepare("SELECT status FROM translation_jobs WHERE page_id = 'human'").get()).toEqual(
      {
        status: "pending",
      },
    );
  });

  it("cancels pending automation when English becomes human-maintained", () => {
    db.prepare("UPDATE pages SET translation_status_en = 'human' WHERE id = 'missing'").run();
    expect(
      db
        .prepare("SELECT status, lease_until FROM translation_jobs WHERE page_id = 'missing'")
        .get(),
    ).toEqual({ status: "completed", lease_until: null });
  });
});
