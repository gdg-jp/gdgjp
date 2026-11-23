import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { insertJob, leaseNextJob } from "./job.repository.server";

function createDb(): D1Database {
  const raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync(new URL("../../../schema.sql", import.meta.url), "utf8"));
  raw.exec(
    "INSERT INTO campaigns (id, chapter_id, chapter_slug, slug, name, playbook_version, created_by) VALUES (1, 1, 'tokyo', 'devfest', 'DevFest', 'v1', 'u1')",
  );
  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => raw.prepare(sql).get(...(params as never[])) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...(params as never[])) }),
    run: async () => ({
      meta: { changes: Number(raw.prepare(sql).run(...(params as never[])).changes) },
    }),
  });
  return { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
}

const enqueue = (db: D1Database) =>
  insertJob(db, {
    campaignId: 1,
    payload: { type: "plan", briefVersion: 1 },
    requestedBy: "u1",
  });

const lease = (db: D1Database, host: string) =>
  leaseNextJob(db, { types: ["plan"], host, now: 2_000_000_000 });

describe("leaseNextJob", () => {
  it("hands one queued job to exactly one of two concurrent runners", async () => {
    const db = createDb();
    const id = await enqueue(db);
    const leased = await Promise.all([lease(db, "runner-a"), lease(db, "runner-b")]);
    const winners = leased.filter((job) => job !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({ id, status: "leased" });
  });

  it("gives concurrent runners distinct jobs until the queue is empty", async () => {
    const db = createDb();
    const ids = [await enqueue(db), await enqueue(db), await enqueue(db)];
    const hosts = ["a", "b", "c", "d", "e"];
    const leased = await Promise.all(hosts.map((host) => lease(db, host)));
    const got = leased.flatMap((job) => (job ? [job.id] : []));
    expect(got.sort()).toEqual(ids.sort());
  });
});
