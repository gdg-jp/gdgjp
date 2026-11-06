import type { AdFlight, Medium } from "./flight";

type Row = {
  id: number;
  campaign_id: number;
  medium: Medium;
  name: string;
  start_at: number;
  end_at: number;
  planned_yen: number;
  actual_yen: number | null;
  phases: string;
  overrun_alerted_at: number | null;
  plan_version: number | null;
};

const toFlight = (r: Row): AdFlight => ({
  id: r.id,
  campaignId: r.campaign_id,
  medium: r.medium,
  name: r.name,
  startAt: r.start_at,
  endAt: r.end_at,
  plannedYen: r.planned_yen,
  actualYen: r.actual_yen,
  phases: JSON.parse(r.phases || "[]"),
  overrunAlertedAt: r.overrun_alerted_at,
  planVersion: r.plan_version,
});

export async function listFlights(db: D1Database, campaignId: number): Promise<AdFlight[]> {
  const { results } = await db
    .prepare("SELECT * FROM ad_flights WHERE campaign_id = ? ORDER BY start_at, id")
    .bind(campaignId)
    .all<Row>();
  return results.map(toFlight);
}

export async function insertFlight(
  db: D1Database,
  f: Omit<AdFlight, "id" | "actualYen" | "overrunAlertedAt">,
) {
  await db
    .prepare(
      "INSERT INTO ad_flights (campaign_id, medium, name, start_at, end_at, planned_yen, phases, plan_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      f.campaignId,
      f.medium,
      f.name,
      f.startAt,
      f.endAt,
      f.plannedYen,
      JSON.stringify(f.phases),
      f.planVersion,
    )
    .run();
}

export async function updateFlight(
  db: D1Database,
  campaignId: number,
  id: number,
  patch: { name?: string; plannedYen?: number; startAt?: number; endAt?: number },
) {
  await db
    .prepare(
      `UPDATE ad_flights SET name = COALESCE(?, name), planned_yen = COALESCE(?, planned_yen), start_at = COALESCE(?, start_at),
         end_at = COALESCE(?, end_at), updated_at = unixepoch() WHERE campaign_id = ? AND id = ?`,
    )
    .bind(
      patch.name ?? null,
      patch.plannedYen ?? null,
      patch.startAt ?? null,
      patch.endAt ?? null,
      campaignId,
      id,
    )
    .run();
}

export async function deleteFlight(db: D1Database, campaignId: number, id: number) {
  await db
    .prepare("DELETE FROM ad_flights WHERE campaign_id = ? AND id = ?")
    .bind(campaignId, id)
    .run();
}

export async function setActual(db: D1Database, id: number, actualYen: number) {
  await db
    .prepare("UPDATE ad_flights SET actual_yen = ?, updated_at = unixepoch() WHERE id = ?")
    .bind(actualYen, id)
    .run();
}

/** Claim the one overrun alert per flight. */
export async function claimOverrunAlert(db: D1Database, id: number): Promise<boolean> {
  const r = await db
    .prepare(
      "UPDATE ad_flights SET overrun_alerted_at = unixepoch() WHERE id = ? AND overrun_alerted_at IS NULL",
    )
    .bind(id)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/** Plan adoption: flights from budgetAllocation.flights, replacing the previous plan's untouched ones. */
export async function replacePlanFlights(
  db: D1Database,
  campaignId: number,
  eventAt: number,
  planVersion: number,
  flights: {
    medium: Medium;
    name: string;
    startDaysBefore: number;
    endDaysBefore: number;
    plannedYen: number;
    phases: AdFlight["phases"];
  }[],
) {
  await db
    .prepare(
      "DELETE FROM ad_flights WHERE campaign_id = ? AND plan_version IS NOT NULL AND actual_yen IS NULL",
    )
    .bind(campaignId)
    .run();
  for (const f of flights)
    await insertFlight(db, {
      campaignId,
      medium: f.medium,
      name: f.name,
      startAt: eventAt - f.startDaysBefore * 86400,
      endAt: eventAt - f.endDaysBefore * 86400,
      plannedYen: f.plannedYen,
      phases: f.phases,
      planVersion,
    });
}
