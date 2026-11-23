import type { SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "~/db/schema";
import { createSpacesTestDb } from "~/features/spaces/test-db";

vi.mock("~/features/notifications/notify.server", () => ({ createNotification: vi.fn() }));

import { enqueueSynthesize } from "./enqueue.server";
import {
  MAX_ATTEMPTS,
  completeJob,
  extendJobLease,
  leaseNextJob,
  requeueExpiredJobs,
} from "./runner.server";

type Fixture = ReturnType<typeof createSpacesTestDb>;
const fixtures = new Set<Fixture>();
afterEach(() => {
  for (const fixture of fixtures) fixture.sqlite.close();
  fixtures.clear();
  vi.useRealTimers();
});

it("checks 648 bounded lifecycle sequences against an independent state machine", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const commands = [
    "lease-vm",
    "lease-other",
    "recover",
    "heartbeat-original",
    "complete-original",
    "retry-original",
  ] as const;
  const sequences = commands.flatMap((first) =>
    commands.flatMap((second) => commands.map((third) => [first, second, third])),
  );
  let cases = 0;
  let transitions = 0;
  for (const initialAttempt of [0, 1, 2]) {
    for (const sequence of sequences) {
      let now = 1_800_000_000_000;
      vi.setSystemTime(now);
      const result = fixture({ attempts: initialAttempt, lease_until: now / 1000 + 1200 });
      const model: {
        status: string;
        owner: string | null;
        attempts: number;
        until: number | null;
      } = { status: "leased", owner: "vm", attempts: initialAttempt, until: now + 1_200_000 };
      const recover = () => {
        if (model.status !== "leased" || model.until === null || model.until >= now) return 0;
        model.attempts++;
        model.status = model.attempts >= 3 ? "failed" : "queued";
        model.owner = null;
        model.until = null;
        return 1;
      };
      try {
        for (const command of sequence) {
          const originalOwnsLease =
            model.status === "leased" && model.owner === "vm" && model.attempts === initialAttempt;
          if (command === "recover") {
            now += 86_400_000;
            vi.setSystemTime(now);
            const expected = recover();
            expect(await requeueExpiredJobs(result.db), sequence.join("/")).toBe(expected);
          } else if (command === "lease-vm" || command === "lease-other") {
            recover();
            const host = command === "lease-vm" ? "vm" : "other";
            const eligible = model.status === "queued";
            if (eligible) {
              model.status = "leased";
              model.owner = host;
              model.until = now + 1_200_000;
            }
            const leased = await leaseNextJob(result.db, { types: ["translate"], host });
            expect(
              leased ? { host: leased.leaseOwner, attempts: leased.attempts } : null,
              sequence.join("/"),
            ).toEqual(eligible ? { host, attempts: model.attempts } : null);
          } else if (command === "heartbeat-original") {
            expect(
              await extendJobLease(result.db, {
                jobId: "job",
                host: "vm",
                attempts: initialAttempt,
              }),
              sequence.join("/"),
            ).toBe(originalOwnsLease);
            if (originalOwnsLease) model.until = now + 1_200_000;
          } else {
            const retry = command === "retry-original";
            expect(
              await completeJob({} as Env, result.db, {
                jobId: "job",
                host: "vm",
                attempts: initialAttempt,
                status: retry ? "failed" : "succeeded",
                retry,
              }),
              sequence.join("/"),
            ).toEqual({ ok: originalOwnsLease });
            if (originalOwnsLease) {
              model.until = null;
              model.status = retry ? "failed" : "succeeded";
              if (retry && model.attempts + 1 < 3) {
                model.status = "queued";
                model.attempts++;
                model.owner = null;
              }
            }
          }
          expect(
            result.sqlite
              .prepare(
                "SELECT status, lease_owner AS owner, attempts FROM agent_jobs WHERE id='job'",
              )
              .get(),
            sequence.join("/"),
          ).toEqual({ status: model.status, owner: model.owner, attempts: model.attempts });
          transitions++;
        }
        cases++;
      } finally {
        result.sqlite.close();
        fixtures.delete(result);
      }
    }
  }
  expect(cases).toBe(648);
  expect(transitions).toBe(1944);
  console.info(
    JSON.stringify({
      verification: "job-lifecycle",
      cases,
      transitions,
      bounds: { jobs: 1, hosts: 2, initialAttempts: [0, 1, 2], depth: 3 },
    }),
  );
}, 120_000);

it("serializes duplicate recovery and concurrent arrival without losing or duplicating requests", async () => {
  const old = {
    pageSlug: "page",
    text: "old",
    requestedBy: "alice",
    requestedByName: "Alice",
    requestedAt: 0,
  };
  const waiting = { ...old, text: "waiting" };
  const arriving = { ...old, text: "arriving" };
  const result = fixture({
    type: "synthesize",
    payload: JSON.stringify({ sourceIds: ["old"], documentIds: ["old"], requests: [old] }),
  });
  result.sqlite
    .prepare("INSERT INTO agent_jobs (id,type,space_id,status,payload) VALUES (?,?,?,?,?)")
    .run(
      "waiting",
      "synthesize",
      "gdg-jp",
      "queued",
      JSON.stringify({ sourceIds: ["waiting"], documentIds: ["waiting"], requests: [waiting] }),
    );
  const db = interleave(result, async () => {});
  const lease = { jobId: "job", host: "vm", attempts: 0, status: "failed" as const, retry: true };
  const outcomes = await Promise.all([
    completeJob({} as Env, db, lease),
    completeJob({} as Env, db, lease),
    enqueueSynthesize(db, {
      spaceId: "gdg-jp",
      sourceIds: ["arriving"],
      documentIds: ["arriving"],
      requests: [arriving],
    }),
  ]);
  expect(outcomes.slice(0, 2).filter((outcome) => "ok" in outcome && outcome.ok)).toHaveLength(1);
  const row = result.sqlite.prepare("SELECT payload FROM agent_jobs WHERE id='waiting'").get();
  if (typeof row?.payload !== "string") throw new Error("Waiting payload missing");
  const payload = JSON.parse(row.payload);
  expect(payload.sourceIds.toSorted()).toEqual(["arriving", "old", "waiting"]);
  expect(payload.documentIds.toSorted()).toEqual(["arriving", "old", "waiting"]);
  expect(payload.requests).toHaveLength(3);
  expect(payload.requests).toEqual(expect.arrayContaining([old, waiting, arriving]));
});

it("checks clone exclusivity across two spaces and 27 three-request sequences", async () => {
  const requests = [
    { types: ["synthesize"] as const, host: "vm" },
    { types: ["consolidate"] as const, host: "other" },
    { types: ["synthesize", "consolidate"] as const, host: "third" },
  ];
  let cases = 0;
  for (const first of requests)
    for (const second of requests)
      for (const third of requests) {
        const result = fixture({ type: "synthesize", status: "queued" });
        try {
          result.sqlite.exec(`INSERT INTO spaces(id,slug,name,kind) VALUES('second','second','Second','shared');
        INSERT INTO agent_jobs(id,type,space_id,status) VALUES('gdg-consolidate','consolidate','gdg-jp','queued'),('second-synthesize','synthesize','second','queued'),('second-consolidate','consolidate','second','queued')`);
          const leasedIds = new Set<string>();
          for (const request of [first, second, third]) {
            const job = await leaseNextJob(result.db, request);
            if (job) {
              expect(leasedIds.has(job.id)).toBe(false);
              leasedIds.add(job.id);
            }
            const invalid = result.sqlite
              .prepare(
                "SELECT space_id FROM agent_jobs WHERE status='leased' AND type IN ('synthesize','consolidate') GROUP BY space_id HAVING COUNT(*) > 1",
              )
              .all();
            expect(invalid).toEqual([]);
          }
          expect(leasedIds.size).toBeGreaterThan(0);
          cases++;
        } finally {
          result.sqlite.close();
          fixtures.delete(result);
        }
      }
  expect(cases).toBe(27);
});

function fixture(values: Record<string, SQLInputValue> = {}) {
  const result = createSpacesTestDb();
  fixtures.add(result);
  const row = {
    id: "job",
    type: "translate",
    status: "leased",
    priority: 0,
    payload: "{}",
    space_id: "gdg-jp",
    run_after: 0,
    lease_owner: "vm",
    lease_until: 1,
    attempts: 0,
    ...values,
  };
  result.sqlite
    .prepare(
      `INSERT INTO agent_jobs (${Object.keys(row).join(",")}) VALUES (${Object.keys(row)
        .map(() => "?")
        .join(",")})`,
    )
    .run(...Object.values(row));
  return result;
}

function interleave(
  result: Fixture,
  after: (query: string, method: string) => Promise<void>,
  before?: (query: string, method: string) => Promise<void>,
) {
  const execute = (query: string, params: unknown[], method: string) => {
    const bindings = params.map((value): SQLInputValue => {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "bigint" ||
        value instanceof Uint8Array
      )
        return value;
      throw new Error("Unexpected SQLite binding");
    });
    const statement = result.sqlite.prepare(query);
    if (method === "run") {
      const changes = statement.run(...bindings).changes;
      return { rows: [], meta: { changes } };
    }
    const rows = statement.all(...bindings).map((row) => Object.values(row));
    return { rows: method === "get" ? rows[0] : rows };
  };
  const db = drizzle(
    async (query, params, method) => {
      if (before) await before(query, method);
      const response = execute(query, params, method);
      await after(query, method);
      return response;
    },
    async (batch) => {
      result.sqlite.exec("BEGIN IMMEDIATE");
      try {
        const responses = [];
        for (const query of batch) responses.push(execute(query.sql, query.params, query.method));
        result.sqlite.exec("COMMIT");
        return responses;
      } catch (error) {
        result.sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    { schema },
  );
  return db as unknown as Fixture["db"];
}

describe("bounded production lease interleavings", () => {
  it("rejects a different host even when it knows the active generation", async () => {
    const result = fixture();
    expect(await extendJobLease(result.db, { jobId: "job", host: "other", attempts: 0 })).toBe(
      false,
    );
    expect(
      await completeJob({} as Env, result.db, {
        jobId: "job",
        host: "other",
        attempts: 0,
        status: "succeeded",
      }),
    ).toEqual({ ok: false });
  });
  for (const status of ["succeeded", "failed", "needs_review"] as const) {
    for (const nextHost of ["vm", "other-vm"]) {
      it(`rejects stale ${status} after re-lease to ${nextHost}`, async () => {
        const result = fixture();
        let interrupted = false;
        const db = interleave(result, async (query, method) => {
          if (
            interrupted ||
            method !== "get" ||
            !query.startsWith("select ") ||
            !query.includes('"agent_jobs"')
          )
            return;
          interrupted = true;
          await requeueExpiredJobs(result.db);
          const next = await leaseNextJob(result.db, { types: ["translate"], host: nextHost });
          expect(next?.attempts).toBe(1);
        });
        expect(
          await completeJob({} as Env, db, {
            jobId: "job",
            host: "vm",
            attempts: 0,
            status,
            retry: status === "failed",
            ...(status === "needs_review" ? { reviewFlag: { kind: "acl-untagged" as const } } : {}),
          }),
        ).toEqual({ ok: false });
        expect(
          result.sqlite.prepare("SELECT status, lease_owner, attempts FROM agent_jobs").get(),
        ).toEqual({ status: "leased", lease_owner: nextHost, attempts: 1 });
        expect(result.sqlite.prepare("SELECT id FROM review_flags").all()).toEqual([]);
      });
    }
  }

  it("rejects same-host stale heartbeats and results by their captured attempt", async () => {
    const result = fixture();
    await requeueExpiredJobs(result.db);
    const next = await leaseNextJob(result.db, { types: ["translate"], host: "vm" });
    expect(next?.attempts).toBe(1);
    expect(await extendJobLease(result.db, { jobId: "job", host: "vm", attempts: 0 })).toBe(false);
    expect(
      await completeJob({} as Env, result.db, {
        jobId: "job",
        host: "vm",
        attempts: 0,
        status: "succeeded",
      }),
    ).toEqual({ ok: false });
    expect(await extendJobLease(result.db, { jobId: "job", host: "vm", attempts: 1 })).toBe(true);
  });

  for (const attempts of [0, MAX_ATTEMPTS - 1]) {
    it(`does not reclaim a renewed lease at attempt ${attempts}`, async () => {
      const result = fixture({ attempts });
      let interrupted = false;
      const db = interleave(result, async (query, method) => {
        if (
          interrupted ||
          method !== "all" ||
          !query.startsWith("select ") ||
          !query.includes('"agent_jobs"')
        )
          return;
        interrupted = true;
        expect(await extendJobLease(result.db, { jobId: "job", host: "vm", attempts })).toBe(true);
      });
      expect(await requeueExpiredJobs(db)).toBe(0);
      expect(
        result.sqlite.prepare("SELECT status, lease_owner, attempts FROM agent_jobs").get(),
      ).toEqual({ status: "leased", lease_owner: "vm", attempts });
    });
  }

  it("conserves every acknowledged source, document and request during concurrent enqueue", async () => {
    const result = fixture({
      type: "synthesize",
      status: "queued",
      payload: '{"sourceIds":["base"],"documentIds":[]}',
    });
    const requests = ["a", "b", "c"].map((name) => ({
      pageSlug: "page",
      text: name,
      requestedBy: name,
      requestedByName: name,
      requestedAt: 0,
    }));
    const outcomes = await Promise.all(
      requests.map((request) =>
        enqueueSynthesize(result.db, {
          spaceId: "gdg-jp",
          sourceIds: [request.text],
          documentIds: [request.text],
          requests: [request],
        }),
      ),
    );
    expect(outcomes).toHaveLength(3);
    const row = result.sqlite.prepare("SELECT payload FROM agent_jobs WHERE id='job'").get();
    if (typeof row?.payload !== "string") throw new Error("Queued payload missing");
    expect(JSON.parse(row.payload)).toEqual({
      sourceIds: ["base", "a", "b", "c"],
      documentIds: ["a", "b", "c"],
      requests,
    });
  });
});

it("keeps recovery payload transfer atomic when independent SQL requests arrive out of order", async () => {
  const result = fixture({
    type: "synthesize",
    payload: '{"sourceIds":["old"],"documentIds":["old"]}',
  });
  result.sqlite
    .prepare("INSERT INTO agent_jobs (id,type,space_id,status,payload) VALUES (?,?,?,?,?)")
    .run("waiting", "synthesize", "gdg-jp", "queued", '{"sourceIds":["waiting"],"documentIds":[]}');
  let sourceTransition: (() => void) | undefined;
  const transitioned = new Promise<void>((resolve) => {
    sourceTransition = resolve;
  });
  const db = interleave(
    result,
    async (query) => {
      if (query.startsWith('update "agent_jobs" set "status"')) sourceTransition?.();
    },
    async (query) => {
      if (query.startsWith('update "agent_jobs"') && query.includes('"payload" ='))
        await transitioned;
    },
  );
  expect(
    await completeJob({} as Env, db, {
      jobId: "job",
      host: "vm",
      attempts: 0,
      status: "failed",
      retry: true,
    }),
  ).toEqual({ ok: true });
  const waiting = result.sqlite.prepare("SELECT payload FROM agent_jobs WHERE id='waiting'").get();
  if (typeof waiting?.payload !== "string") throw new Error("Waiting payload missing");
  expect(JSON.parse(waiting.payload)).toEqual({
    sourceIds: ["waiting", "old"],
    documentIds: ["old"],
    requests: [],
  });
});
