import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("0026_generation_agent_overhaul migration", () => {
  it("fails only unfinished sessions and preserves terminal review data", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE ingestion_sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL,
      ai_draft_json TEXT, error_message TEXT, phase_message TEXT, workflow_id TEXT,
      updated_at INTEGER NOT NULL);`);
    const insert = db.prepare(
      "INSERT INTO ingestion_sessions VALUES (?, ?, ?, NULL, 'old', 'workflow', 1)",
    );
    for (const status of [
      "pending",
      "processing",
      "awaiting_url_selection",
      "awaiting_clarification",
      "done",
      "archived",
      "error",
    ])
      insert.run(status, status, `draft:${status}`);
    db.exec(
      readFileSync(
        new URL("../../migrations/0026_generation_agent_overhaul.sql", import.meta.url),
        "utf8",
      ),
    );
    const rows = db.prepare("SELECT * FROM ingestion_sessions").all() as unknown as Array<
      Record<string, unknown>
    >;
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const status of [
      "pending",
      "processing",
      "awaiting_url_selection",
      "awaiting_clarification",
    ]) {
      expect(byId.get(status)).toMatchObject({
        status: "error",
        phase_message: null,
        workflow_id: null,
        ai_draft_json: `draft:${status}`,
      });
    }
    for (const status of ["done", "archived", "error"]) {
      expect(byId.get(status)).toMatchObject({
        status,
        phase_message: "old",
        workflow_id: "workflow",
        ai_draft_json: `draft:${status}`,
      });
    }
  });
});
