import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("0025_agent_ingestion migration", () => {
  it("ends only incomplete sessions and preserves terminal sessions", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE ingestion_sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        error_message TEXT,
        phase_message TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
    const statuses = [
      "pending",
      "processing",
      "awaiting_clarification",
      "awaiting_url_selection",
      "done",
      "archived",
      "error",
    ];
    const insert = db.prepare(
      "INSERT INTO ingestion_sessions (id, status, phase_message, updated_at) VALUES (?, ?, ?, ?)",
    );
    for (const status of statuses) insert.run(status, status, "before", 1);

    db.exec(
      readFileSync(new URL("../../migrations/0025_agent_ingestion.sql", import.meta.url), "utf8"),
    );

    const rows = db
      .prepare("SELECT id, status, phase_message FROM ingestion_sessions ORDER BY id")
      .all() as unknown as Array<{ id: string; status: string; phase_message: string | null }>;
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const status of statuses.slice(0, 4)) {
      expect(byId.get(status)).toMatchObject({
        status: "error",
        phase_message: "Restart required after AI ingestion upgrade.",
      });
    }
    for (const status of ["done", "archived", "error"]) {
      expect(byId.get(status)).toMatchObject({ status, phase_message: "before" });
    }
    expect(db.prepare("PRAGMA table_info(ingestion_sessions)").all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "workflow_id" }),
        expect.objectContaining({ name: "access_context_json" }),
        expect.objectContaining({ name: "context_manifest_json" }),
      ]),
    );
  });
});
