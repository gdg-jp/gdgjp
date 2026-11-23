import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { spin } from "./draw.server";

const migrations = fileURLToPath(new URL("../../../migrations/", import.meta.url));

type Statement = { sql: string; params: SQLInputValue[] };

function sqliteD1(raw: DatabaseSync, beforeSpinWrite: () => void): D1Database {
  const run = ({ sql, params }: Statement) => raw.prepare(sql).all(...params);
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    sql,
    params,
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    first: async () => run({ sql, params })[0] ?? null,
    all: async () => ({ results: run({ sql, params }) }),
  });
  return {
    prepare: (sql: string) => statement(sql),
    async batch(statements: Statement[]) {
      if (statements.some(({ sql }) => sql.startsWith("UPDATE project SET draws"))) {
        beforeSpinWrite();
      }
      raw.exec("BEGIN");
      try {
        const results = statements.map((item) => ({ results: run(item) }));
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}

function setup(beforeFirstSpinWrite: (raw: DatabaseSync) => void = () => {}) {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations).sort()) {
    raw.exec(readFileSync(`${migrations}${file}`, "utf8"));
  }
  raw.exec(`INSERT INTO project (slug, name, chapter_id, chapter_slug, is_open, method)
            VALUES ('fest', 'Fest', 1, 'tokyo', 1, 'box')`);
  raw.exec(`INSERT INTO prize (id, project_slug, position, name, stock)
            VALUES ('gold', 'fest', 0, 'Gold', 1), ('lose', 'fest', 1, 'Lose', NULL)`);
  let pending = true;
  const db = sqliteD1(raw, () => {
    if (!pending) return;
    pending = false;
    beforeFirstSpinWrite(raw);
  });
  const state = () => ({
    draws: raw.prepare("SELECT draws FROM project WHERE slug = 'fest'").get()?.draws,
    won: Object.fromEntries(
      raw
        .prepare("SELECT id, won FROM prize ORDER BY position")
        .all()
        .map((row) => [row.id, row.won]),
    ),
    log: raw.prepare("SELECT prize_id, number, device_id FROM draw ORDER BY number").all(),
  });
  return { db, state };
}

const pickFirst = () => 0;

describe("spin", () => {
  it("counts the spin, takes the prize and records the draw in one batch", async () => {
    const { db, state } = setup();

    const outcome = await spin(db, "fest", "device-a", pickFirst);

    expect(outcome).toMatchObject({ status: "won", result: { prizeId: "gold", number: 1 } });
    expect(state()).toEqual({
      draws: 1,
      won: { gold: 1, lose: 0 },
      log: [{ prize_id: "gold", number: 1, device_id: "device-a" }],
    });
  });

  it("rolls the whole batch back and re-picks when the prize ran out after the read", async () => {
    const { db, state } = setup((raw) => {
      raw.exec("UPDATE prize SET won = 1 WHERE id = 'gold'");
    });

    const outcome = await spin(db, "fest", "device-a", pickFirst);

    expect(outcome).toMatchObject({ status: "won", result: { prizeId: "lose", number: 1 } });
    expect(state()).toEqual({
      draws: 1,
      won: { gold: 1, lose: 1 },
      log: [{ prize_id: "lose", number: 1, device_id: "device-a" }],
    });
  });

  it("rolls the whole batch back when the project closed after the read", async () => {
    const { db, state } = setup((raw) => {
      raw.exec("UPDATE project SET is_open = 0 WHERE slug = 'fest'");
    });

    const outcome = await spin(db, "fest", "device-a", pickFirst);

    expect(outcome).toEqual({ status: "closed" });
    expect(state()).toEqual({ draws: 0, won: { gold: 0, lose: 0 }, log: [] });
  });
});
