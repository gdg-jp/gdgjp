import { describe, expect, it, vi } from "vitest";
import { createSpacesTestDb } from "~/features/spaces/test-db";

vi.mock("~/features/notifications/notify.server", () => ({ createNotification: vi.fn() }));

import { createNotification } from "~/features/notifications/notify.server";
import { completeJob, leaseNextJob, requeueExpiredJobs } from "./runner.server";
import { applyTranslation, spansMatch, translationSourceHash } from "./translate.server";

function insertJob(
  sqlite: ReturnType<typeof createSpacesTestDb>["sqlite"],
  values: Record<string, unknown>,
) {
  const row = { status: "queued", priority: 0, payload: "{}", space_id: "gdg-jp", ...values };
  const keys = Object.keys(row);
  sqlite
    .prepare(`INSERT INTO agent_jobs (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
    .run(...(Object.values(row) as never[]));
}

describe("leaseNextJob", () => {
  it("never leases two clone jobs of one space at once", async () => {
    const { db, sqlite } = createSpacesTestDb();
    insertJob(sqlite, { id: "s1", type: "synthesize", run_after: 0 });
    insertJob(sqlite, { id: "c1", type: "consolidate", run_after: 0 });
    const first = await leaseNextJob(db, { types: ["synthesize", "consolidate"], host: "a" });
    const second = await leaseNextJob(db, { types: ["synthesize", "consolidate"], host: "b" });
    expect(first?.id).toBe("s1");
    expect(second).toBeNull();
  });

  it("does not let an expired lease block its space until the hourly cron", async () => {
    const { db, sqlite } = createSpacesTestDb();
    insertJob(sqlite, {
      id: "dead",
      type: "synthesize",
      status: "leased",
      lease_until: 1,
      attempts: 1,
      run_after: 0,
    });
    const leased = await leaseNextJob(db, { types: ["synthesize"], host: "a" });
    expect(leased?.id).toBe("dead");
    expect(leased?.attempts).toBe(2);
    // Still one clone job per space.
    insertJob(sqlite, { id: "next", type: "synthesize", run_after: 0 });
    expect(await leaseNextJob(db, { types: ["synthesize"], host: "b" })).toBeNull();
  });

  it("merges an expired job into the space's queued one instead of violating the index", async () => {
    // c-2: a runner restart left its synthesize leased while new Discord documents queued a
    // second one. Requeueing the first broke idx_agent_jobs_one_queued_per_space.
    const { db, sqlite } = createSpacesTestDb();
    insertJob(sqlite, {
      id: "dead",
      type: "synthesize",
      status: "leased",
      lease_until: 1,
      attempts: 1,
      run_after: 0,
      payload: JSON.stringify({ sourceIds: ["drive"], documentIds: ["d1", "d2"] }),
    });
    insertJob(sqlite, {
      id: "next",
      type: "synthesize",
      run_after: 0,
      payload: JSON.stringify({ sourceIds: ["discord"], documentIds: ["d3"] }),
    });
    const leased = await leaseNextJob(db, { types: ["synthesize"], host: "a" });
    expect(leased?.id).toBe("next");
    expect(JSON.parse(leased?.payload ?? "{}")).toEqual({
      sourceIds: ["discord", "drive"],
      documentIds: ["d3", "d1", "d2"],
      requests: [],
    });
    expect(sqlite.prepare("SELECT status, error FROM agent_jobs WHERE id = 'dead'").get()).toEqual({
      status: "failed",
      error: "merged into queued job next",
    });
  });

  it("respects run_after and priority", async () => {
    const { db, sqlite } = createSpacesTestDb();
    const future = Math.floor(Date.now() / 1000) + 3600;
    insertJob(sqlite, { id: "later", type: "translate", run_after: future, priority: 10 });
    insertJob(sqlite, { id: "low", type: "translate", run_after: 0, priority: -5 });
    insertJob(sqlite, { id: "high", type: "translate", run_after: 0, priority: 5 });
    expect((await leaseNextJob(db, { types: ["translate"], host: "a" }))?.id).toBe("high");
    expect((await leaseNextJob(db, { types: ["translate"], host: "a" }))?.id).toBe("low");
    expect(await leaseNextJob(db, { types: ["translate"], host: "a" })).toBeNull();
  });
});

describe("requeueExpiredJobs", () => {
  it("returns expired leases to the queue and fails them after three attempts", async () => {
    const { db, sqlite } = createSpacesTestDb();
    insertJob(sqlite, {
      id: "a",
      type: "synthesize",
      status: "leased",
      lease_until: 1,
      attempts: 0,
    });
    insertJob(sqlite, {
      id: "b",
      type: "translate",
      status: "leased",
      lease_until: 1,
      attempts: 2,
    });
    await requeueExpiredJobs(db);
    const rows = sqlite.prepare("SELECT id, status, attempts FROM agent_jobs ORDER BY id").all();
    expect(rows).toEqual([
      { id: "a", status: "queued", attempts: 1 },
      { id: "b", status: "failed", attempts: 3 },
    ]);
  });
});

describe("completeJob", () => {
  it("marks integrated documents and notifies requesters", async () => {
    const { db, sqlite } = createSpacesTestDb();
    sqlite.exec(`
      INSERT INTO sources (id, kind, url, title, added_by, status, visibility)
        VALUES ('s1', 'website', 'https://a.example', 'A', 'alice', 'ready', 'member');
      INSERT INTO source_documents (id, source_id, path, title, r2_key, content_hash, captured_at)
        VALUES ('d1', 's1', 'a.md', 'A', 'k', 'h1', 0);
    `);
    insertJob(sqlite, {
      id: "j",
      type: "synthesize",
      status: "leased",
      lease_owner: "vm",
      payload: JSON.stringify({
        sourceIds: ["s1"],
        documentIds: ["d1"],
        requests: [
          {
            pageSlug: "venue",
            text: "x",
            requestedBy: "bob",
            requestedByName: "Bob",
            requestedAt: 0,
          },
        ],
      }),
    });
    expect(
      await completeJob({} as Env, db, { jobId: "j", host: "other", status: "succeeded" }),
    ).toEqual({ ok: false });
    expect(
      await completeJob({} as Env, db, { jobId: "j", host: "vm", status: "succeeded" }),
    ).toEqual({ ok: true });
    expect(sqlite.prepare("SELECT integrated_hash FROM source_documents").get()).toEqual({
      integrated_hash: "h1",
    });
    expect(
      sqlite.prepare("SELECT last_integrated_at IS NOT NULL AS done FROM sources").get(),
    ).toEqual({ done: 1 });
    expect(vi.mocked(createNotification)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ userId: "bob", type: "agent_request" }),
    );
  });
});

describe("completeJob retry and review", () => {
  it("merges a retryable failure into a newer queued job of the same space", async () => {
    const { db, sqlite } = createSpacesTestDb();
    insertJob(sqlite, {
      id: "r",
      type: "synthesize",
      status: "leased",
      lease_owner: "vm",
      payload: JSON.stringify({ sourceIds: ["s1"], documentIds: ["d1"] }),
    });
    insertJob(sqlite, {
      id: "q",
      type: "synthesize",
      payload: '{"sourceIds":[],"documentIds":[]}',
    });
    const result = await completeJob({} as Env, db, {
      jobId: "r",
      host: "vm",
      status: "failed",
      retry: true,
      error: "verify-acl: boom",
    });
    expect(result.ok).toBe(true);
    expect(
      sqlite.prepare("SELECT id, status, error, payload FROM agent_jobs ORDER BY id").all(),
    ).toEqual([
      {
        id: "q",
        status: "queued",
        error: null,
        payload: '{"sourceIds":["s1"],"documentIds":["d1"],"requests":[]}',
      },
      {
        id: "r",
        status: "failed",
        error: "merged into queued job q: verify-acl: boom",
        payload: '{"sourceIds":["s1"],"documentIds":["d1"]}',
      },
    ]);
  });

  it("requeues a retryable failure until attempts run out", async () => {
    const { db, sqlite } = createSpacesTestDb();
    insertJob(sqlite, { id: "r", type: "synthesize", status: "leased", lease_owner: "vm" });
    insertJob(sqlite, {
      id: "x",
      type: "synthesize",
      status: "leased",
      lease_owner: "vm",
      attempts: 2,
      space_id: "gdg-jp",
    });
    await completeJob({} as Env, db, { jobId: "r", host: "vm", status: "failed", retry: true });
    await completeJob({} as Env, db, { jobId: "x", host: "vm", status: "failed", retry: true });
    expect(sqlite.prepare("SELECT id, status, attempts FROM agent_jobs ORDER BY id").all()).toEqual(
      [
        { id: "r", status: "queued", attempts: 1 },
        { id: "x", status: "failed", attempts: 2 },
      ],
    );
  });

  it("opens an acl-untagged flag for needs_review", async () => {
    const { db, sqlite } = createSpacesTestDb();
    insertJob(sqlite, { id: "n", type: "synthesize", status: "leased", lease_owner: "vm" });
    await completeJob({} as Env, db, {
      jobId: "n",
      host: "vm",
      status: "needs_review",
      reviewFlag: { kind: "acl-untagged", payload: { findings: [{ slug: "a" }] } },
    });
    expect(sqlite.prepare("SELECT target_type, target_id, kind FROM review_flags").all()).toEqual([
      { target_type: "job", target_id: "n", kind: "acl-untagged" },
    ]);
  });
});

describe("applyTranslation", () => {
  async function seed() {
    const ctx = createSpacesTestDb();
    ctx.sqlite.exec(`INSERT INTO pages (id, title_ja, slug, content_ja, content_en, author_id, last_edited_by)
      VALUES ('p', '会場', 'venue', '会場は梅田。<acl src="org">契約 12 万円</acl>', 'old', 'alice', 'alice')`);
    return {
      ...ctx,
      hash: await translationSourceHash("会場", '会場は梅田。<acl src="org">契約 12 万円</acl>'),
    };
  }

  it("writes only the English side", async () => {
    const { db, sqlite, hash } = await seed();
    const result = await applyTranslation(db, {
      pageId: "p",
      sourceHash: hash,
      titleEn: "Venue",
      contentEn: 'Venue is Umeda. <acl src="org">Contract 120k yen</acl>',
    });
    expect(result).toEqual({ ok: true });
    expect(
      sqlite.prepare("SELECT content_ja, title_en, translation_status_en FROM pages").get(),
    ).toEqual({
      content_ja: '会場は梅田。<acl src="org">契約 12 万円</acl>',
      title_en: "Venue",
      translation_status_en: "ai",
    });
  });

  it("refuses a translation that drops a span (it would show restricted text unredacted)", async () => {
    const { db, hash } = await seed();
    await expect(
      applyTranslation(db, {
        pageId: "p",
        sourceHash: hash,
        titleEn: "",
        contentEn: "Venue is Umeda. Contract 120k yen",
      }),
    ).resolves.toMatchObject({ ok: false, error: "acl_required" });
  });

  it("refuses a translation of an outdated Japanese text", async () => {
    const { db } = await seed();
    await expect(
      applyTranslation(db, { pageId: "p", sourceHash: "stale", titleEn: "", contentEn: "x" }),
    ).resolves.toMatchObject({ ok: false, status: 409, error: "stale_source" });
  });

  it("compares spans by count and src", () => {
    expect(spansMatch('<acl src="a">x</acl>', '<acl src="a">y</acl>')).toBe(true);
    expect(spansMatch('<acl src="a">x</acl>', '<acl src="b">y</acl>')).toBe(false);
  });
});
