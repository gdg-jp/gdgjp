import { overrun } from "~/features/budget/flight";
import {
  claimOverrunAlert,
  listFlights,
  setActual,
} from "~/features/budget/flight.repository.server";
import type { CampaignAccess } from "~/features/campaigns/access.server";
import { notifyChapter } from "~/features/notify/send.server";
import { constants } from "~/features/playbook/playbook";
import { type ColumnMap, mapAdRows, parseCsv } from "./csv";
import { replaceCsvSnapshot } from "./snapshot.repository.server";

const MEDIUM = { x_ads_csv: "x_ads", ig_ads_csv: "ig_ads" } as const;

export async function columnMaps(
  db: D1Database,
  chapterId: number,
): Promise<Record<string, ColumnMap>> {
  const row = await db
    .prepare("SELECT ads_column_maps FROM chapter_settings WHERE chapter_id = ?")
    .bind(chapterId)
    .first<{ ads_column_maps: string }>();
  return JSON.parse(row?.ads_column_maps ?? "{}");
}

async function saveColumnMap(
  db: D1Database,
  chapterId: number,
  source: string,
  map: ColumnMap,
  userId: string,
) {
  const maps = { ...(await columnMaps(db, chapterId)), [source]: map };
  await db
    .prepare(
      `INSERT INTO chapter_settings (chapter_id, ads_column_maps, updated_by) VALUES (?, ?, ?)
       ON CONFLICT (chapter_id) DO UPDATE SET ads_column_maps = excluded.ads_column_maps, updated_at = unixepoch()`,
    )
    .bind(chapterId, JSON.stringify(maps), userId)
    .run();
}

/**
 * One ads export: rows mapped by the chapter's saved column map, stored as the snapshot for its
 * period (replacing an earlier import of the same period), spend summed into the overlapping
 * flights, and one Discord alert per flight that overruns.
 */
export async function importAdsCsv(
  env: Env,
  access: CampaignAccess,
  input: { source: "x_ads_csv" | "ig_ads_csv"; csv: string; map: ColumnMap },
) {
  const parsed = mapAdRows(parseCsv(input.csv), input.map);
  if (!parsed.rows.length)
    return {
      ok: false as const,
      errors: parsed.problems.length ? parsed.problems : ["行がありません"],
    };
  const dates = parsed.rows.map((r) => r.date).sort();
  const periodStart = Math.floor(Date.parse(`${dates[0]}T00:00:00+09:00`) / 1000);
  const periodEnd = Math.floor(Date.parse(`${dates.at(-1)}T23:59:59+09:00`) / 1000);
  await replaceCsvSnapshot(env.DB, {
    campaignId: access.campaign.id,
    source: input.source,
    payload: { rows: parsed.rows },
    periodStart,
    periodEnd,
    importedBy: access.user.id,
  });
  await saveColumnMap(env.DB, access.campaign.chapterId, input.source, input.map, access.user.id);
  const spend = parsed.rows.reduce((n, r) => n + r.spendYen, 0);
  const flights = (await listFlights(env.DB, access.campaign.id)).filter(
    (f) => f.medium === MEDIUM[input.source] && f.startAt <= periodEnd && f.endAt >= periodStart,
  );
  const alerts: string[] = [];
  const target =
    flights.length === 1
      ? flights[0]
      : flights.find((f) => parsed.rows.some((r) => r.campaignName === f.name));
  if (target) {
    await setActual(env.DB, target.id, spend);
    const reason = overrun(
      { ...target, actualYen: spend },
      constants.budget.overrunAlertRatio,
      Math.floor(Date.now() / 1000),
    );
    if (reason && (await claimOverrunAlert(env.DB, target.id))) {
      alerts.push(reason);
      await notifyChapter(env, {
        chapterId: access.campaign.chapterId,
        campaignId: access.campaign.id,
        itemId: null,
        key: `overrun:${target.id}`,
        content: `${access.campaign.name} / ${target.name}: ${reason}`,
        action: "discord_overrun",
      });
    }
  }
  return {
    ok: true as const,
    message: `${parsed.rows.length} 行を取り込みました（費用 ${spend.toLocaleString("ja-JP")} 円${target ? `、${target.name} の実績に反映` : flights.length > 1 ? "。フライトを特定できないので実績は手で入れてください" : ""}）`,
    alerts,
    problems: parsed.problems,
  };
}
