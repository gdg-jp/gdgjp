export type Source = "tinyurl" | "connpass_stats" | "connpass_survey" | "x_ads_csv" | "ig_ads_csv";
export type Snapshot = {
  id: number;
  source: Source;
  capturedAt: number;
  periodStart: number | null;
  periodEnd: number | null;
  payload: Record<string, unknown>;
};

export async function addSnapshot(
  db: D1Database,
  s: {
    campaignId: number;
    source: Source;
    payload: unknown;
    periodStart?: number | null;
    periodEnd?: number | null;
    importedBy?: string | null;
  },
) {
  await db
    .prepare(
      "INSERT INTO metric_snapshots (campaign_id, source, captured_at, period_start, period_end, payload, imported_by) VALUES (?, ?, unixepoch(), ?, ?, ?, ?)",
    )
    .bind(
      s.campaignId,
      s.source,
      s.periodStart ?? null,
      s.periodEnd ?? null,
      JSON.stringify(s.payload),
      s.importedBy ?? null,
    )
    .run();
}

/** A CSV for the same period replaces the previous one (no double counting). */
export async function replaceCsvSnapshot(
  db: D1Database,
  s: {
    campaignId: number;
    source: "x_ads_csv" | "ig_ads_csv";
    payload: unknown;
    periodStart: number;
    periodEnd: number;
    importedBy: string;
  },
) {
  await db.batch([
    db
      .prepare(
        "DELETE FROM metric_snapshots WHERE campaign_id = ? AND source = ? AND period_start = ? AND period_end = ?",
      )
      .bind(s.campaignId, s.source, s.periodStart, s.periodEnd),
    db
      .prepare(
        "INSERT INTO metric_snapshots (campaign_id, source, captured_at, period_start, period_end, payload, imported_by) VALUES (?, ?, unixepoch(), ?, ?, ?, ?)",
      )
      .bind(
        s.campaignId,
        s.source,
        s.periodStart,
        s.periodEnd,
        JSON.stringify(s.payload),
        s.importedBy,
      ),
  ]);
}

export async function listSnapshots(
  db: D1Database,
  campaignId: number,
  source: Source,
  limit = 500,
): Promise<Snapshot[]> {
  const { results } = await db
    .prepare(
      "SELECT id, source, captured_at, period_start, period_end, payload FROM metric_snapshots WHERE campaign_id = ? AND source = ? ORDER BY captured_at, id LIMIT ?",
    )
    .bind(campaignId, source, limit)
    .all<{
      id: number;
      source: Source;
      captured_at: number;
      period_start: number | null;
      period_end: number | null;
      payload: string;
    }>();
  return results.map((r) => ({
    id: r.id,
    source: r.source,
    capturedAt: r.captured_at,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    payload: JSON.parse(r.payload),
  }));
}
