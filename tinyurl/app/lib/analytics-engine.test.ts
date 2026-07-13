import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aeQuery,
  clearAeCache,
  clicksByLinkIdAndSourceSql,
  conversionClicksByHourSql,
  granularityFor,
  hourlyClicks,
  hourlyClicksByLinkIdAndSourceSql,
  hourlySql,
  topByBlob,
  topSql,
  totalClicks,
  totalSql,
} from "./analytics-engine";

const env = { CF_ACCOUNT_ID: "acc_123", CF_AE_API_TOKEN: "token_abc" };

const ID_A = "link_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ID_B = "link_01ARZ3NDEKTSV4RRFFQ69G5FBW";
const ID_C = "link_01ARZ3NDEKTSV4RRFFQ69G5FCX";

describe("analytics-engine SQL", () => {
  it("hourlySql for a single link defaults to rolling 7 days, hourly buckets are switched to daily over 48h", () => {
    expect(hourlySql([ID_A])).toMatchInlineSnapshot(`
      "SELECT toStartOfDay(timestamp) AS hour, count() AS clicks
      FROM tinyurl_clicks
      WHERE index1 IN ('link_01ARZ3NDEKTSV4RRFFQ69G5FAV') AND timestamp > now() - INTERVAL '168' HOUR
      GROUP BY hour
      ORDER BY hour"
    `);
  });

  it("hourlySql uses hourly buckets for short rolling windows", () => {
    expect(hourlySql([ID_A], { window: { kind: "rolling", hours: 24 } })).toContain(
      "toStartOfHour(timestamp)",
    );
    expect(hourlySql([ID_A], { window: { kind: "rolling", hours: 24 } })).toContain(
      "INTERVAL '24' HOUR",
    );
  });

  it("hourlySql uses weekly buckets for long rolling windows", () => {
    expect(hourlySql([ID_A], { window: { kind: "rolling", hours: 24 * 365 } })).toContain(
      "toStartOfWeek(timestamp)",
    );
  });

  it("hourlySql supports toDate windows", () => {
    expect(hourlySql([ID_A], { window: { kind: "toDate", unit: "month" } })).toContain(
      "timestamp >= toStartOfMonth(now())",
    );
    expect(hourlySql([ID_A], { window: { kind: "toDate", unit: "quarter" } })).toContain(
      "toStartOfQuarter(now())",
    );
    expect(hourlySql([ID_A], { window: { kind: "toDate", unit: "year" } })).toContain(
      "toStartOfYear(now())",
    );
  });

  it("hourlySql with all-time window drops the time clause", () => {
    const sql = hourlySql([ID_A], { window: { kind: "all" } });
    expect(sql).toContain("AND 1=1");
    expect(sql).not.toContain("timestamp >");
    expect(sql).not.toContain("INTERVAL");
  });

  it("hourlySql with custom range uses toDateTime bounds", () => {
    expect(
      hourlySql([ID_A], {
        window: { kind: "custom", startIso: "2026-05-01", endIso: "2026-05-12" },
      }),
    ).toContain(
      "timestamp >= toDateTime('2026-05-01 00:00:00') AND timestamp < toDateTime('2026-05-12 00:00:00') + INTERVAL '1' DAY",
    );
  });

  it("hourlySql for all links", () => {
    expect(hourlySql("all")).toContain("WHERE 1=1");
  });

  it("hourlySql returns no rows when ids list is empty", () => {
    expect(hourlySql([])).toContain("WHERE 1=0");
  });

  it("topSql produces the right blob index", () => {
    expect(topSql("country", [ID_A])).toMatchInlineSnapshot(`
      "SELECT blob2 AS name, count() AS clicks
      FROM tinyurl_clicks
      WHERE index1 IN ('link_01ARZ3NDEKTSV4RRFFQ69G5FAV') AND timestamp > now() - INTERVAL '168' HOUR
      GROUP BY name
      ORDER BY clicks DESC
      LIMIT 10"
    `);
    expect(topSql("device", "all", 5, { window: { kind: "rolling", hours: 24 * 30 } })).toContain(
      "blob9",
    );
    expect(topSql("device", "all", 5)).toContain("LIMIT 5");
    expect(topSql("device", "all", 5, { window: { kind: "rolling", hours: 24 * 30 } })).toContain(
      "INTERVAL '720' HOUR",
    );
    expect(topSql("source", "all")).toContain("SELECT blob10 AS name");
  });

  it("topSql appends dimension filters", () => {
    const sql = topSql("city", "all", 10, {
      filters: { country: ["JP", "US"], browser: ["Chrome"] },
    });
    expect(sql).toContain("AND blob2 IN ('JP', 'US')");
    expect(sql).toContain("AND blob7 IN ('Chrome')");
  });

  it("totalSql counts rows", () => {
    expect(totalSql([ID_A, ID_B, ID_C])).toContain("SELECT count() AS clicks");
    expect(totalSql([ID_A, ID_B, ID_C])).toContain(`index1 IN ('${ID_A}', '${ID_B}', '${ID_C}')`);
  });

  it("groups campaign analysis by link and source", () => {
    const sql = clicksByLinkIdAndSourceSql([ID_A, ID_B], {
      filters: { source: ["discord-a"] },
    });
    expect(sql).toContain("SELECT index1 AS linkId, blob10 AS source, count() AS clicks");
    expect(sql).toContain("AND blob10 IN ('discord-a')");
    expect(sql).toContain("GROUP BY linkId, source");
  });

  it("groups campaign trends by time, link, and source", () => {
    const sql = hourlyClicksByLinkIdAndSourceSql([ID_A, ID_B], {
      window: { kind: "rolling", hours: 24 },
    });
    expect(sql).toContain(
      "SELECT toStartOfHour(timestamp) AS hour, index1 AS linkId, blob10 AS source",
    );
    expect(sql).toContain("GROUP BY hour, linkId, source");
    expect(sql).toContain("ORDER BY hour");
  });

  it("keeps conversion attribution clicks at hourly granularity for long windows", () => {
    const sql = conversionClicksByHourSql([ID_A], {
      window: { kind: "rolling", hours: 24 * 365 },
    });
    expect(sql).toContain("SELECT toStartOfHour(timestamp) AS hour");
    expect(sql).toContain("INTERVAL '8784' HOUR");
    expect(sql).not.toContain("toStartOfWeek");
  });

  it("rejects malformed link ids", () => {
    expect(() => hourlySql(["not-a-link-id"])).toThrow(/link id/);
    expect(() => hourlySql(["link_short"])).toThrow(/link id/);
  });

  it("rejects unsafe dimension filter values", () => {
    expect(() => topSql("country", "all", 10, { filters: { country: ["' OR 1=1 --"] } })).toThrow(
      /country filter value/,
    );
    expect(() => topSql("slug", "all", 10, { filters: { slug: ["abc; DROP TABLE"] } })).toThrow(
      /slug filter value/,
    );
    expect(() => topSql("source", "all", 10, { filters: { source: ["Tokyo"] } })).toThrow(
      /source filter value/,
    );
  });

  it("rejects unsafe custom date strings", () => {
    expect(() =>
      hourlySql([ID_A], {
        window: { kind: "custom", startIso: "2026-05-01'; DROP", endIso: "2026-05-12" },
      }),
    ).toThrow(/start/);
  });
});

describe("granularityFor", () => {
  it("picks hour/day/week based on range length", () => {
    expect(granularityFor({ kind: "rolling", hours: 24 })).toBe("hour");
    expect(granularityFor({ kind: "rolling", hours: 24 * 7 })).toBe("day");
    expect(granularityFor({ kind: "rolling", hours: 24 * 365 })).toBe("week");
    expect(granularityFor({ kind: "toDate", unit: "month" })).toBe("day");
    expect(granularityFor({ kind: "all" })).toBe("week");
    expect(granularityFor({ kind: "custom", startIso: "2026-05-01", endIso: "2026-05-12" })).toBe(
      "day",
    );
  });
});

describe("aeQuery", () => {
  beforeEach(() => {
    clearAeCache();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts to the SQL endpoint with bearer auth", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: unknown) =>
        new Response(JSON.stringify({ meta: [], data: [{ clicks: 5 }], rows: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const rows = await aeQuery(env, "SELECT 1");
    expect(rows).toEqual([{ clicks: 5 }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc_123/analytics_engine/sql",
    );
    expect(call[1].method).toBe("POST");
    const headers = call[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token_abc");
    expect(call[1].body).toBe("SELECT 1");
  });

  it("caches identical queries within the TTL", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ meta: [], data: [], rows: 0 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await aeQuery(env, "SELECT 1");
    await aeQuery(env, "SELECT 1");
    expect(fetchMock).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(60_001);
    await aeQuery(env, "SELECT 1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("isolates cached queries by account id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ meta: [], data: [{ clicks: 1 }], rows: 1 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ meta: [], data: [{ clicks: 2 }], rows: 1 }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(aeQuery(env, "SELECT 1")).resolves.toEqual([{ clicks: 1 }]);
    await expect(aeQuery({ ...env, CF_ACCOUNT_ID: "acc_456" }, "SELECT 1")).resolves.toEqual([
      { clicks: 2 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    await expect(aeQuery(env, "SELECT 1")).rejects.toThrow(/401/);
  });
});

describe("typed helpers normalize rows", () => {
  beforeEach(() => clearAeCache());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("hourlyClicks coerces to {hour, clicks}", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              meta: [],
              data: [{ hour: "2026-04-30T10:00:00Z", clicks: 7 }],
              rows: 1,
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await hourlyClicks(env, [ID_A]);
    expect(result).toEqual([{ hour: "2026-04-30T10:00:00Z", clicks: 7 }]);
  });

  it("topByBlob falls back to (unknown) for empty names", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              meta: [],
              data: [
                { name: "JP", clicks: 10 },
                { name: "", clicks: 3 },
              ],
              rows: 2,
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await topByBlob(env, "country", [ID_A]);
    expect(result).toEqual([
      { name: "JP", clicks: 10 },
      { name: "(unknown)", clicks: 3 },
    ]);
  });

  it("totalClicks reads first row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ meta: [], data: [{ clicks: 42 }], rows: 1 }), {
            status: 200,
          }),
      ),
    );
    expect(await totalClicks(env, [ID_A])).toBe(42);
  });
});
