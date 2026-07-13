import type { TopBlob } from "./analytics-engine";

export type PeriodPreset =
  | "24h"
  | "7d"
  | "30d"
  | "3mo"
  | "12mo"
  | "mtd"
  | "qtd"
  | "ytd"
  | "all"
  | "custom";

export const PERIOD_PRESETS: readonly Exclude<PeriodPreset, "custom">[] = [
  "24h",
  "7d",
  "30d",
  "3mo",
  "12mo",
  "mtd",
  "qtd",
  "ytd",
  "all",
] as const;

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "3mo": "Last 3 months",
  "12mo": "Last 12 months",
  mtd: "Month to Date",
  qtd: "Quarter to Date",
  ytd: "Year to Date",
  all: "All Time",
  custom: "Custom range",
};

export const PERIOD_HOTKEYS: Record<Exclude<PeriodPreset, "custom">, string> = {
  "24h": "D",
  "7d": "W",
  "30d": "T",
  "3mo": "3",
  "12mo": "L",
  mtd: "M",
  qtd: "Q",
  ytd: "Y",
  all: "A",
};

export type AnalyticsWindow =
  | { kind: "rolling"; hours: number }
  | { kind: "toDate"; unit: "month" | "quarter" | "year" }
  | { kind: "all" }
  | { kind: "custom"; startIso: string; endIso: string };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function presetToWindow(preset: PeriodPreset): AnalyticsWindow {
  switch (preset) {
    case "24h":
      return { kind: "rolling", hours: 24 };
    case "7d":
      return { kind: "rolling", hours: 24 * 7 };
    case "30d":
      return { kind: "rolling", hours: 24 * 30 };
    case "3mo":
      return { kind: "rolling", hours: 24 * 30 * 3 };
    case "12mo":
      return { kind: "rolling", hours: 24 * 365 };
    case "mtd":
      return { kind: "toDate", unit: "month" };
    case "qtd":
      return { kind: "toDate", unit: "quarter" };
    case "ytd":
      return { kind: "toDate", unit: "year" };
    case "all":
      return { kind: "all" };
    case "custom":
      throw new Error("presetToWindow: 'custom' requires explicit start/end");
  }
}

export const FILTER_DIMENSIONS: readonly TopBlob[] = [
  "slug",
  "country",
  "city",
  "region",
  "continent",
  "browser",
  "os",
  "device",
  "referer",
  "source",
] as const;

export type DimensionFilters = Partial<Record<TopBlob, readonly string[]>>;

// Validators per dimension. Reject anything that wouldn't survive `quote()` safely
// even though quote() is already escape-safe — defense in depth + sane URL params.
const VALIDATORS: Record<TopBlob, RegExp> = {
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

export function isValidDimensionValue(dim: TopBlob, value: string): boolean {
  return VALIDATORS[dim].test(value);
}

export type ParsedAnalyticsParams = {
  preset: PeriodPreset;
  window: AnalyticsWindow;
  filters: DimensionFilters;
};

export function parseAnalyticsParams(searchParams: URLSearchParams): ParsedAnalyticsParams {
  const rawPeriod = searchParams.get("period");
  let preset: PeriodPreset = "7d";
  if (rawPeriod !== null) {
    if (rawPeriod === "custom" || PERIOD_PRESETS.includes(rawPeriod as never)) {
      preset = rawPeriod as PeriodPreset;
    }
  }

  let window: AnalyticsWindow;
  if (preset === "custom") {
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    if (start && end && isIsoDate(start) && isIsoDate(end) && start <= end) {
      window = { kind: "custom", startIso: start, endIso: end };
    } else {
      preset = "7d";
      window = presetToWindow("7d");
    }
  } else {
    window = presetToWindow(preset);
  }

  const filters: DimensionFilters = {};
  for (const dim of FILTER_DIMENSIONS) {
    const values = searchParams.getAll(dim).filter((v) => isValidDimensionValue(dim, v));
    if (values.length > 0) {
      const unique = Array.from(new Set(values));
      filters[dim] = unique;
    }
  }

  return { preset, window, filters };
}

export function serializeAnalyticsParams(
  current: URLSearchParams,
  next: { preset?: PeriodPreset; startIso?: string; endIso?: string; filters?: DimensionFilters },
): URLSearchParams {
  const out = new URLSearchParams(current);

  if (next.preset !== undefined) {
    out.delete("period");
    out.delete("start");
    out.delete("end");
    if (next.preset !== "7d") {
      out.set("period", next.preset);
    }
    if (next.preset === "custom") {
      if (next.startIso) out.set("start", next.startIso);
      if (next.endIso) out.set("end", next.endIso);
    }
  }

  if (next.filters !== undefined) {
    for (const dim of FILTER_DIMENSIONS) out.delete(dim);
    for (const dim of FILTER_DIMENSIONS) {
      const values = next.filters[dim];
      if (!values || values.length === 0) continue;
      for (const v of values) {
        if (isValidDimensionValue(dim, v)) out.append(dim, v);
      }
    }
  }

  return out;
}
