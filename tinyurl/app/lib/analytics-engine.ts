import type { AnalyticsWindow, DimensionFilters } from "./analytics-filters";

export type AeRow = Record<string, string | number | null>;

type AeResponse = {
  meta: { name: string; type: string }[];
  data: AeRow[];
  rows: number;
};

const DATASET = "tinyurl_clicks";
const CACHE_TTL_MS = 60_000;
const QUERY_TIMEOUT_MS = 15_000;

type CacheEntry = { at: number; rows: AeRow[] };
const cache = new Map<string, CacheEntry>();

export function clearAeCache(): void {
  cache.clear();
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function intOrThrow(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer (got ${value})`);
  }
  return value;
}

const LINK_ID_RE = /^link_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

function linkIdOrThrow(value: string, name: string): string {
  if (!LINK_ID_RE.test(value)) {
    throw new Error(`${name} must be a link id (got ${value})`);
  }
  return value;
}

export type AeEnv = {
  CF_ACCOUNT_ID: string;
  CF_AE_API_TOKEN: string;
};

export async function aeQuery(env: AeEnv, sql: string): Promise<AeRow[]> {
  if (!env.CF_ACCOUNT_ID || !env.CF_AE_API_TOKEN) {
    throw new Error(
      "Analytics Engine query requires CF_ACCOUNT_ID and CF_AE_API_TOKEN secrets to be set on the worker",
    );
  }

  const now = Date.now();
  const cacheKey = `${env.CF_ACCOUNT_ID}:${sql}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    if (now - cached.at < CACHE_TTL_MS) return cached.rows;
    cache.delete(cacheKey);
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CF_AE_API_TOKEN}`,
        "Content-Type": "text/plain",
      },
      body: sql,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Analytics Engine query timed out after ${QUERY_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Analytics Engine query failed (${response.status}): ${text}`);
  }
  const json = (await response.json()) as AeResponse;
  cache.set(cacheKey, { at: now, rows: json.data ?? [] });
  return json.data ?? [];
}

export type TopBlob =
  | "slug"
  | "country"
  | "region"
  | "city"
  | "continent"
  | "referer"
  | "browser"
  | "os"
  | "device"
  | "source";

const BLOB_INDEX: Record<TopBlob, number> = {
  slug: 1,
  country: 2,
  region: 3,
  city: 4,
  continent: 5,
  referer: 6,
  browser: 7,
  os: 8,
  device: 9,
  source: 10,
};

export const DEFAULT_WINDOW: AnalyticsWindow = { kind: "rolling", hours: 24 * 7 };

export type QueryOpts = {
  window?: AnalyticsWindow;
  filters?: DimensionFilters;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDateOrThrow(value: string, name: string): string {
  if (!ISO_DATE_RE.test(value)) {
    throw new Error(`${name} must be YYYY-MM-DD (got ${value})`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be YYYY-MM-DD (got ${value})`);
  }
  return value;
}

function windowClause(window: AnalyticsWindow, lookbackHours = 0): string {
  switch (window.kind) {
    case "rolling": {
      const h = intOrThrow(window.hours, "hours");
      return `timestamp > now() - INTERVAL '${h + lookbackHours}' HOUR`;
    }
    case "toDate": {
      const fn =
        window.unit === "month"
          ? "toStartOfMonth"
          : window.unit === "quarter"
            ? "toStartOfQuarter"
            : "toStartOfYear";
      const lookback = lookbackHours > 0 ? ` - INTERVAL '${lookbackHours}' HOUR` : "";
      return `timestamp >= ${fn}(now())${lookback}`;
    }
    case "all":
      return "1=1";
    case "custom": {
      const start = isoDateOrThrow(window.startIso, "start");
      const end = isoDateOrThrow(window.endIso, "end");
      // end is inclusive at the day level, so use < (end + 1 day)
      const lookback = lookbackHours > 0 ? ` - INTERVAL '${lookbackHours}' HOUR` : "";
      return `timestamp >= toDateTime('${start} 00:00:00')${lookback} AND timestamp < toDateTime('${end} 00:00:00') + INTERVAL '1' DAY`;
    }
  }
}

const DIMENSION_VALUE_RE: Record<TopBlob, RegExp> = {
  slug: /^[A-Za-z0-9_-]{1,64}$/,
  country: /^[A-Z]{2}$/,
  continent: /^[A-Z]{2}$/,
  region: /^[\p{L}\p{N}\s.\-'_]{1,80}$/u,
  city: /^[\p{L}\p{N}\s.\-'_]{1,80}$/u,
  browser: /^[A-Za-z0-9 .\-_/]{1,64}$/,
  os: /^[A-Za-z0-9 .\-_/]{1,64}$/,
  device: /^[A-Za-z0-9 .\-_/]{1,32}$/,
  referer: /^[A-Za-z0-9:/.\-_?=&%#+~]{1,200}$/,
  source: /^[a-z0-9][a-z0-9_-]{0,31}$/,
};

function dimensionValueOrThrow(dim: TopBlob, value: string): string {
  if (!DIMENSION_VALUE_RE[dim].test(value)) {
    throw new Error(`${dim} filter value is invalid (got ${value})`);
  }
  return value;
}

function blobFiltersClause(filters: DimensionFilters | undefined): string {
  if (!filters) return "";
  const parts: string[] = [];
  for (const dim of Object.keys(filters) as TopBlob[]) {
    const values = filters[dim];
    if (!values || values.length === 0) continue;
    const blob = `blob${BLOB_INDEX[dim]}`;
    const quoted = values.map((v) => quote(dimensionValueOrThrow(dim, v))).join(", ");
    parts.push(`${blob} IN (${quoted})`);
  }
  return parts.length === 0 ? "" : ` AND ${parts.join(" AND ")}`;
}

export type Granularity = "hour" | "day" | "week";

export function granularityFor(window: AnalyticsWindow): Granularity {
  switch (window.kind) {
    case "rolling":
      if (window.hours <= 24 * 14) return "hour";
      if (window.hours <= 24 * 60) return "day";
      return "week";
    case "toDate":
      return window.unit === "month" ? "day" : "week";
    case "custom": {
      const start = new Date(`${window.startIso}T00:00:00Z`).getTime();
      const end = new Date(`${window.endIso}T00:00:00Z`).getTime();
      const days = (end - start) / 86_400_000 + 1;
      if (days <= 14) return "hour";
      if (days <= 60) return "day";
      return "week";
    }
    case "all":
      return "week";
  }
}

function bucketFnFor(granularity: Granularity): string {
  return granularity === "hour"
    ? "toStartOfHour"
    : granularity === "day"
      ? "toStartOfDay"
      : "toStartOfWeek";
}

export type HourlyPoint = { hour: string; clicks: number };

export function hourlySql(linkIds: string[] | "all", opts: QueryOpts = {}): string {
  const window = opts.window ?? DEFAULT_WINDOW;
  const filter = linkIdsFilter(linkIds);
  const bucketFn = bucketFnFor(granularityFor(window));
  return `SELECT ${bucketFn}(timestamp) AS hour, count() AS clicks
FROM ${DATASET}
WHERE ${filter} AND ${windowClause(window)}${blobFiltersClause(opts.filters)}
GROUP BY hour
ORDER BY hour`;
}

export async function hourlyClicks(
  env: AeEnv,
  linkIds: string[] | "all",
  opts: QueryOpts = {},
): Promise<HourlyPoint[]> {
  const rows = await aeQuery(env, hourlySql(linkIds, opts));
  return rows.map((r) => ({
    hour: String(r.hour ?? ""),
    clicks: Number(r.clicks ?? 0),
  }));
}

export type TopRow = { name: string; clicks: number };

export function topSql(
  field: TopBlob,
  linkIds: string[] | "all",
  limit = 10,
  opts: QueryOpts = {},
): string {
  const blob = `blob${BLOB_INDEX[field]}`;
  const lim = intOrThrow(limit, "limit");
  const window = opts.window ?? DEFAULT_WINDOW;
  const filter = linkIdsFilter(linkIds);
  return `SELECT ${blob} AS name, count() AS clicks
FROM ${DATASET}
WHERE ${filter} AND ${windowClause(window)}${blobFiltersClause(opts.filters)}
GROUP BY name
ORDER BY clicks DESC
LIMIT ${lim}`;
}

export async function topByBlob(
  env: AeEnv,
  field: TopBlob,
  linkIds: string[] | "all",
  limit = 10,
  opts: QueryOpts = {},
): Promise<TopRow[]> {
  const rows = await aeQuery(env, topSql(field, linkIds, limit, opts));
  return rows.map((r) => ({
    name: String(r.name ?? "") || "(unknown)",
    clicks: Number(r.clicks ?? 0),
  }));
}

export function clicksByLinkIdSql(linkIds: string[], opts: QueryOpts = {}): string {
  const window = opts.window ?? DEFAULT_WINDOW;
  const filter = linkIdsFilter(linkIds);
  return `SELECT index1 AS linkId, count() AS clicks
FROM ${DATASET}
WHERE ${filter} AND ${windowClause(window)}${blobFiltersClause(opts.filters)}
GROUP BY linkId`;
}

export async function clicksByLinkId(
  env: AeEnv,
  linkIds: string[],
  opts: QueryOpts = {},
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (linkIds.length === 0) return map;
  const rows = await aeQuery(env, clicksByLinkIdSql(linkIds, opts));
  for (const row of rows) {
    const id = String(row.linkId ?? "");
    const clicks = Number(row.clicks ?? 0);
    if (id) map.set(id, clicks);
  }
  return map;
}

export type LinkSourceClicks = { linkId: string; source: string; clicks: number };

export type CampaignTrendClick = LinkSourceClicks & { hour: string };

export function hourlyClicksByLinkIdAndSourceSql(linkIds: string[], opts: QueryOpts = {}): string {
  const window = opts.window ?? DEFAULT_WINDOW;
  const filter = linkIdsFilter(linkIds);
  const bucketFn = bucketFnFor(granularityFor(window));
  return `SELECT ${bucketFn}(timestamp) AS hour, index1 AS linkId, blob10 AS source, count() AS clicks
FROM ${DATASET}
WHERE ${filter} AND ${windowClause(window)}${blobFiltersClause(opts.filters)}
GROUP BY hour, linkId, source
ORDER BY hour`;
}

export async function hourlyClicksByLinkIdAndSource(
  env: AeEnv,
  linkIds: string[],
  opts: QueryOpts = {},
): Promise<CampaignTrendClick[]> {
  if (linkIds.length === 0) return [];
  const rows = await aeQuery(env, hourlyClicksByLinkIdAndSourceSql(linkIds, opts));
  return rows.map((row) => ({
    hour: String(row.hour ?? ""),
    linkId: String(row.linkId ?? ""),
    source: String(row.source ?? ""),
    clicks: Number(row.clicks ?? 0),
  }));
}

export function conversionClicksByHourSql(linkIds: string[], opts: QueryOpts = {}): string {
  const window = opts.window ?? DEFAULT_WINDOW;
  const filter = linkIdsFilter(linkIds);
  return `SELECT toStartOfHour(timestamp) AS hour, index1 AS linkId, blob10 AS source, count() AS clicks
FROM ${DATASET}
WHERE ${filter} AND ${windowClause(window, 24)}${blobFiltersClause(opts.filters)}
GROUP BY hour, linkId, source
ORDER BY hour`;
}

/** Hour-level click buckets used to estimate registrations near click activity. */
export async function conversionClicksByHour(
  env: AeEnv,
  linkIds: string[],
  opts: QueryOpts = {},
): Promise<CampaignTrendClick[]> {
  if (linkIds.length === 0) return [];
  const rows = await aeQuery(env, conversionClicksByHourSql(linkIds, opts));
  return rows.map((row) => ({
    hour: String(row.hour ?? ""),
    linkId: String(row.linkId ?? ""),
    source: String(row.source ?? ""),
    clicks: Number(row.clicks ?? 0),
  }));
}

export function clicksByLinkIdAndSourceSql(linkIds: string[], opts: QueryOpts = {}): string {
  const window = opts.window ?? DEFAULT_WINDOW;
  const filter = linkIdsFilter(linkIds);
  return `SELECT index1 AS linkId, blob10 AS source, count() AS clicks
FROM ${DATASET}
WHERE ${filter} AND ${windowClause(window)}${blobFiltersClause(opts.filters)}
GROUP BY linkId, source`;
}

export async function clicksByLinkIdAndSource(
  env: AeEnv,
  linkIds: string[],
  opts: QueryOpts = {},
): Promise<LinkSourceClicks[]> {
  if (linkIds.length === 0) return [];
  const rows = await aeQuery(env, clicksByLinkIdAndSourceSql(linkIds, opts));
  return rows.map((row) => ({
    linkId: String(row.linkId ?? ""),
    source: String(row.source ?? ""),
    clicks: Number(row.clicks ?? 0),
  }));
}

export function totalSql(linkIds: string[] | "all", opts: QueryOpts = {}): string {
  const window = opts.window ?? DEFAULT_WINDOW;
  const filter = linkIdsFilter(linkIds);
  return `SELECT count() AS clicks
FROM ${DATASET}
WHERE ${filter} AND ${windowClause(window)}${blobFiltersClause(opts.filters)}`;
}

export async function totalClicks(
  env: AeEnv,
  linkIds: string[] | "all",
  opts: QueryOpts = {},
): Promise<number> {
  const rows = await aeQuery(env, totalSql(linkIds, opts));
  return Number(rows[0]?.clicks ?? 0);
}

function linkIdsFilter(linkIds: string[] | "all"): string {
  if (linkIds === "all") return "1=1";
  if (linkIds.length === 0) return "1=0";
  const ids = linkIds.map((id) => quote(linkIdOrThrow(id, "linkId"))).join(", ");
  return `index1 IN (${ids})`;
}
