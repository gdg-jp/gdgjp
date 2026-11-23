import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fetchSource from "./features/sources/fetch-source";

vi.mock("./decommissioned", () => ({
  WikiGenerationAgent: class {},
  WikiGenerationPhaseWorkflow: class {},
}));
vi.mock("./collab-durable-object", () => ({ CollabDurableObject: class {} }));
vi.mock("./source-import-durable-object", () => ({ SourceImportDurableObject: class {} }));

const { default: worker } = await import("./app");

const wranglerCrons: string[] = JSON.parse(
  readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")
    .split("\n")
    .find((line) => line.startsWith("crons ="))
    ?.slice("crons =".length) ?? "[]",
);

function handledCrons(): string[] {
  const source = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
  const imported = fetchSource as unknown as Record<string, unknown>;
  return [...source.matchAll(/event\.cron === (\w+)/g)].map(([, name = ""]) => {
    const local = source.match(new RegExp(`const ${name} = "([^"]+)"`))?.[1];
    const value = local ?? imported[name];
    expect(typeof value, name).toBe("string");
    return value as string;
  });
}

function unrecognized(cron: string): boolean {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      p.catch(() => {});
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  worker.scheduled?.(
    { cron, scheduledTime: 0, noRetry: () => {} } as ScheduledController,
    { DB: {} } as unknown as Env,
    ctx,
  );
  return warn.mock.calls.some(([message]) => String(message).includes("unrecognized cron"));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("scheduled crons", () => {
  it("handles exactly the crons wrangler.toml declares", () => {
    expect(wranglerCrons.length).toBeGreaterThan(0);
    expect([...handledCrons()].sort()).toEqual([...wranglerCrons].sort());
  });

  it("dispatches every wrangler.toml cron to a handler branch", () => {
    for (const cron of wranglerCrons) {
      expect(unrecognized(cron), cron).toBe(false);
    }
    expect(unrecognized("1 2 3 4 5")).toBe(true);
  });
});
