/** The fields an ads CSV row is mapped to (the rest of the columns are ignored). */
export const AD_FIELDS = [
  "date",
  "campaignName",
  "adName",
  "spendYen",
  "impressions",
  "clicks",
  "linkClicks",
  "results",
] as const;
export type AdField = (typeof AD_FIELDS)[number];
export const REQUIRED_AD_FIELDS: readonly AdField[] = ["date", "spendYen", "impressions", "clicks"];

export const AD_FIELD_LABELS: Record<AdField, string> = {
  date: "日付",
  campaignName: "キャンペーン名",
  adName: "広告名",
  spendYen: "費用",
  impressions: "インプレッション",
  clicks: "クリック",
  linkClicks: "リンクのクリック",
  results: "結果",
};

export type ColumnMap = Partial<Record<AdField, string>>;
export type AdRow = {
  date: string;
  campaignName: string | null;
  adName: string | null;
  spendYen: number;
  impressions: number;
  clicks: number;
  linkClicks: number | null;
  results: number | null;
};

/** RFC 4180-ish: quoted fields with commas, doubled quotes and newlines; a BOM is dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

/** "¥12,345" / "12,345.6 円" → 12346. */
export const toYen = (raw: string) => Math.round(Number(raw.replace(/[^\d.-]/g, "")) || 0);
const toInt = (raw: string | undefined) =>
  raw === undefined || raw.trim() === ""
    ? null
    : Math.round(Number(raw.replace(/[^\d.-]/g, "")) || 0);

/** "2026/9/5", "2026-09-05", "9/5/2026" → "2026-09-05"; null when unreadable. */
export function toDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (m) return `${m[1]}-${m[2]?.padStart(2, "0")}-${m[3]?.padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1]?.padStart(2, "0")}-${m[2]?.padStart(2, "0")}`;
  return null;
}

/** Apply a column map to parsed CSV rows; problems name the column or row that failed. */
export function mapAdRows(rows: string[][], map: ColumnMap): { rows: AdRow[]; problems: string[] } {
  const [header, ...body] = rows;
  if (!header) return { rows: [], problems: ["空の CSV です"] };
  const index = (field: AdField) => (map[field] ? header.indexOf(map[field] as string) : -1);
  const missing = REQUIRED_AD_FIELDS.filter((f) => index(f) < 0);
  if (missing.length)
    return { rows: [], problems: missing.map((f) => `「${AD_FIELD_LABELS[f]}」の列がありません`) };
  const out: AdRow[] = [];
  const problems: string[] = [];
  body.forEach((cells, i) => {
    const get = (f: AdField) => (index(f) >= 0 ? cells[index(f)] : undefined);
    const date = toDate(get("date") ?? "");
    if (!date) {
      // Totals rows and notes at the end of exports have no date.
      if ((get("date") ?? "").trim()) problems.push(`${i + 2} 行目: 日付が読めない`);
      return;
    }
    out.push({
      date,
      campaignName: get("campaignName")?.trim() || null,
      adName: get("adName")?.trim() || null,
      spendYen: toYen(get("spendYen") ?? ""),
      impressions: toInt(get("impressions")) ?? 0,
      clicks: toInt(get("clicks")) ?? 0,
      linkClicks: toInt(get("linkClicks")),
      results: toInt(get("results")),
    });
  });
  return { rows: out, problems };
}

/** Columns a header most likely means, so the first import needs fewer choices. */
export function guessColumnMap(header: string[]): ColumnMap {
  const patterns: Record<AdField, RegExp> = {
    date: /^(日付|日|day|date|報告開始日|reporting starts)/i,
    campaignName: /(キャンペーン名|campaign name|campaign)/i,
    adName: /(広告名|ad name)/i,
    spendYen: /(費用|消化金額|amount spent|spend|cost)/i,
    impressions: /(インプレッション|impressions)/i,
    clicks: /^(クリック|clicks)/i,
    linkClicks: /(リンクのクリック|link clicks)/i,
    results: /^(結果|results|conversions)/i,
  };
  const map: ColumnMap = {};
  for (const field of AD_FIELDS) {
    const hit = header.find((h) => patterns[field].test(h.trim()));
    if (hit) map[field] = hit;
  }
  return map;
}
