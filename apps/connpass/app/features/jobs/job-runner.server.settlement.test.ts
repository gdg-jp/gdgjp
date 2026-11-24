import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, it, vi } from "vitest";

const playwright = vi.hoisted(() => ({
  sessions: vi.fn(),
  connect: vi.fn(),
  launch: vi.fn(),
}));
vi.mock("@cloudflare/playwright", () => ({ ...playwright, default: {} }));

import { getJob, insertQueuedJob } from "./job-repository.server";
import { processJobMessage } from "./job-runner.server";
import type { NewJobInput } from "./job-types";

const migrations = new URL("../../../migrations/", import.meta.url);
const launchError = new Error("spawn Unknown system error -88");

function migratedDatabase(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(fileURLToPath(migrations)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...(params as never[])) ?? null,
    run: async () => {
      const info = sqlite.prepare(sql).run(...(params as never[]));
      return { success: true, meta: { changes: Number(info.changes) } };
    },
  });
  return { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
}

function workerEnv(): Env {
  const kv = new Map<string, string>();
  return {
    DB: migratedDatabase(),
    BROWSER: { fetch: vi.fn() },
    SESSION_KV: {
      get: async (key: string) => kv.get(key) ?? null,
      put: async (key: string, value: string) => {
        kv.set(key, value);
      },
      delete: async (key: string) => {
        kv.delete(key);
      },
    },
  } as unknown as Env;
}

const ctx = {} as ExecutionContext;
let env: Env;

async function queue(input: Partial<NewJobInput> & Pick<NewJobInput, "type">) {
  return insertQueuedJob(env.DB, {
    groupSlug: "gdg-tokyo",
    request: {},
    createdBy: "user-1",
    ...input,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  env = workerEnv();
  playwright.sessions.mockResolvedValue([]);
  playwright.launch.mockRejectedValue(launchError);
});

it("fails a browser job whose Browser Run launch throws instead of leaving it running", async () => {
  const jobId = await queue({ type: "create_event", request: { title: "GDG" } });

  await expect(processJobMessage(env, ctx, { jobId })).rejects.toBe(launchError);

  expect(playwright.launch).toHaveBeenCalledWith(env.BROWSER, expect.anything());
  const failed = await getJob(env.DB, jobId);
  expect(failed).toMatchObject({
    status: "failed",
    error: "spawn Unknown system error -88",
    resultJson: null,
    artifactKey: null,
  });
  expect(failed?.startedAt).not.toBeNull();
  expect(failed?.finishedAt).not.toBeNull();

  await processJobMessage(env, ctx, { jobId });
  expect(playwright.launch).toHaveBeenCalledTimes(1);
  expect(await getJob(env.DB, jobId)).toEqual(failed);
});

it("fails a job rejected after the claim before any browser opens", async () => {
  const jobId = await queue({ type: "update_event", request: { title: "GDG" } });

  await expect(processJobMessage(env, ctx, { jobId })).rejects.toThrow("event_id_required");

  expect(playwright.launch).not.toHaveBeenCalled();
  expect(await getJob(env.DB, jobId)).toMatchObject({
    status: "failed",
    error: "event_id_required",
  });
});

it("fails a relogin job whose cold launch throws", async () => {
  const jobId = await queue({ type: "relogin", groupSlug: "_system" });

  await expect(processJobMessage(env, ctx, { jobId })).rejects.toBe(launchError);

  expect(await getJob(env.DB, jobId)).toMatchObject({
    status: "failed",
    error: "spawn Unknown system error -88",
    artifactKey: null,
  });
});
