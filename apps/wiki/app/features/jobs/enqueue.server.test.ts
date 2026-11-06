import { describe, expect, it } from "vitest";
import { createSpacesTestDb } from "~/features/spaces/test-db";
import { enqueuePendingSynthesis, enqueueSynthesize } from "./enqueue.server";

function jobs(sqlite: ReturnType<typeof createSpacesTestDb>["sqlite"]) {
  return sqlite
    .prepare("SELECT id, status, priority, payload, run_after FROM agent_jobs ORDER BY created_at")
    .all() as Array<{
    id: string;
    status: string;
    priority: number;
    payload: string;
    run_after: number;
  }>;
}

describe("enqueueSynthesize", () => {
  it("merges new work into the space's single queued job", async () => {
    const { db, sqlite } = createSpacesTestDb();
    const first = await enqueueSynthesize(db, {
      spaceId: "gdg-jp",
      sourceIds: ["s1"],
      documentIds: ["d1"],
    });
    const second = await enqueueSynthesize(db, {
      spaceId: "gdg-jp",
      sourceIds: ["s2", "s1"],
      documentIds: ["d2"],
    });
    expect(second).toEqual({ jobId: first.jobId, merged: true });
    const [job] = jobs(sqlite);
    expect(JSON.parse(job?.payload ?? "{}")).toMatchObject({
      sourceIds: ["s1", "s2"],
      documentIds: ["d1", "d2"],
    });
    expect(jobs(sqlite)).toHaveLength(1);
  });

  it("waits an hour after the last finished run, unless asked to integrate now", async () => {
    const { db, sqlite } = createSpacesTestDb();
    const now = new Date("2026-11-06T10:00:00Z");
    const finished = Math.floor(now.getTime() / 1000) - 10 * 60;
    sqlite.exec(`INSERT INTO agent_jobs (id, type, space_id, status, finished_at)
                 VALUES ('done', 'synthesize', 'gdg-jp', 'succeeded', ${finished})`);
    await enqueueSynthesize(db, { spaceId: "gdg-jp", sourceIds: ["s1"], now });
    const queued = jobs(sqlite).find((job) => job.status === "queued");
    expect(queued?.run_after).toBe(finished + 3600);

    await enqueueSynthesize(db, { spaceId: "gdg-jp", manual: true, now });
    const manual = jobs(sqlite).find((job) => job.status === "queued");
    expect(manual?.run_after).toBe(Math.floor(now.getTime() / 1000));
    expect(manual?.priority).toBe(5);
  });

  it("starts a new queued job while another is leased", async () => {
    const { db, sqlite } = createSpacesTestDb();
    sqlite.exec(`INSERT INTO agent_jobs (id, type, space_id, status)
                 VALUES ('running', 'synthesize', 'gdg-jp', 'leased')`);
    const result = await enqueueSynthesize(db, { spaceId: "gdg-jp", sourceIds: ["s1"] });
    expect(result.merged).toBe(false);
    expect(
      jobs(sqlite)
        .map((job) => job.status)
        .sort(),
    ).toEqual(["leased", "queued"]);
  });
});

describe("enqueuePendingSynthesis", () => {
  it("queues one job per space with unintegrated documents and skips active spaces", async () => {
    const { db, sqlite } = createSpacesTestDb();
    sqlite.exec(`
      INSERT INTO sources (id, kind, url, title, added_by, status, visibility)
        VALUES ('s1', 'website', 'https://a.example', 'A', 'alice', 'ready', 'member');
      INSERT INTO source_documents (id, source_id, path, title, r2_key, content_hash, captured_at, integrated_hash)
        VALUES ('d1', 's1', 'a.md', 'A', 'k1', 'h1', 0, NULL),
               ('d2', 's1', 'b.md', 'B', 'k2', 'h2', 0, 'h2');
    `);
    expect(await enqueuePendingSynthesis(db)).toBe(1);
    const [job] = jobs(sqlite);
    expect(JSON.parse(job?.payload ?? "{}").documentIds).toEqual(["d1"]);
    expect(await enqueuePendingSynthesis(db)).toBe(0);
  });
});
