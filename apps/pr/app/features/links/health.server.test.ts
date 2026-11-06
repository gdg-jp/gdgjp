import { describe, expect, it } from "vitest";
import { probe } from "./health.server";
import { healthState, isAlive } from "./link";

const fetcher = (statuses: Record<string, number | Error>) =>
  (async (_url: string, init?: RequestInit) => {
    const status = statuses[init?.method ?? "GET"];
    if (status instanceof Error) throw status;
    return new Response(null, { status });
  }) as unknown as typeof fetch;

describe("probe", () => {
  it("falls back to GET when HEAD is not allowed or fails", async () => {
    expect(await probe("https://e.x", fetcher({ HEAD: 405, GET: 200 }))).toBe(200);
    expect(await probe("https://e.x", fetcher({ HEAD: new Error("x"), GET: 404 }))).toBe(404);
    expect(await probe("https://e.x", fetcher({ HEAD: new Error("x"), GET: new Error("y") }))).toBe(
      0,
    );
  });
});

describe("health state", () => {
  it("is broken from the second failure in a row", () => {
    expect(isAlive(301)).toBe(true);
    expect(isAlive(404)).toBe(false);
    expect(healthState({ healthFailures: 0, healthCheckedAt: null })).toBe("unknown");
    expect(healthState({ healthFailures: 1, healthCheckedAt: 1 })).toBe("warning");
    expect(healthState({ healthFailures: 2, healthCheckedAt: 1 })).toBe("broken");
  });
});
