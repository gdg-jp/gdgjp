import { describe, expect, it } from "vitest";
import { createSpacesTestDb } from "~/features/spaces/test-db";
import { percentile, sampleFreshness, summarizeLatency } from "./freshness.server";

describe("freshness sampling", () => {
  it("records freshness, integration and answer latencies, then summarizes them", async () => {
    const { db, sqlite } = createSpacesTestDb();
    const now = 1_800_000_000;
    sqlite.exec(`
      INSERT INTO sources (id, kind, url, title, added_by, status, visibility, space_id)
        VALUES ('s1', 'website', 'https://a.example', 'A', 'alice', 'ready', 'member', 'gdg-jp');
      INSERT INTO source_documents (id, source_id, path, title, r2_key, content_hash, captured_at)
        VALUES ('d1', 's1', 'a.md', 'A', 'k', 'h', ${now - 3600}),
               ('d2', 's1', 'b.md', 'B', 'k2', 'h2', ${now - 600});
      INSERT INTO knowledge_items (space_id, item_key, item_id, subject_type, subject_id, version, updated_at)
        VALUES ('gdg-jp', 'raw/d1.md', 'i1', 'document', 'd1', 'h', ${now - 3000});
      INSERT INTO agent_jobs (id, type, space_id, status, payload, created_at, finished_at)
        VALUES ('syn', 'synthesize', 'gdg-jp', 'succeeded', '{"sourceIds":["s1"],"documentIds":["d1","d2"]}', ${now - 500}, ${now - 100}),
               ('a1', 'answer', 'gdg-jp', 'succeeded', '{}', ${now - 200}, ${now - 160}),
               ('a2', 'answer', 'gdg-jp', 'expired', '{}', ${now - 200}, ${now - 100});
    `);
    expect(await sampleFreshness(db, new Date(now * 1000))).toBe(5);
    const rows = sqlite
      .prepare("SELECT kind, value_seconds AS v FROM freshness_samples ORDER BY kind, v")
      .all();
    expect(rows).toEqual([
      { kind: "answer", v: 40 },
      { kind: "answer_expired", v: 0 },
      { kind: "answer_expired", v: 1 },
      { kind: "freshness", v: 600 }, // d2 is not indexed yet and is skipped
      { kind: "integration", v: 3500 },
    ]);
    const summary = await summarizeLatency(db, 7, new Date(now * 1000));
    expect(summary.find((s) => s.kind === "answer_expired")?.mean).toBe(0.5);
    expect(summary.find((s) => s.kind === "integration")?.p95).toBe(3500);
  });

  it("computes nearest-rank percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
});
