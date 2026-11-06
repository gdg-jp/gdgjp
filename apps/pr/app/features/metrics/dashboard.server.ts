import { latestBrief } from "~/features/briefs/brief.repository.server";
import { xIgSplit } from "~/features/budget/flight";
import { listFlights } from "~/features/budget/flight.repository.server";
import type { CampaignAccess } from "~/features/campaigns/access.server";
import { listDrafts } from "~/features/drafts/draft.repository.server";
import { healthState } from "~/features/links/link";
import { listLinks } from "~/features/links/link.repository.server";
import { constants } from "~/features/playbook/playbook";
import { listItems } from "~/features/schedule/item.repository.server";
import { goalAt, goalStatus } from "./goal";
import { listSnapshots } from "./snapshot.repository.server";

const day = (epoch: number) => new Date((epoch + 9 * 3600) * 1000).toISOString().slice(0, 10);

/** Everything /c/:slug/metrics shows, from snapshots and the campaign's own tables. */
export async function dashboard(env: Env, access: CampaignAccess) {
  const id = access.campaign.id;
  const brief = (await latestBrief(env.DB, id))?.brief ?? null;
  const [stats, tinyurl, xAds, igAds, flights, items, drafts, links] = await Promise.all([
    listSnapshots(env.DB, id, "connpass_stats"),
    listSnapshots(env.DB, id, "tinyurl"),
    listSnapshots(env.DB, id, "x_ads_csv"),
    listSnapshots(env.DB, id, "ig_ads_csv"),
    listFlights(env.DB, id),
    listItems(env.DB, id),
    listDrafts(env.DB, id),
    listLinks(env.DB, id),
  ]);
  // One point per day: the day's last snapshot.
  const byDay = new Map<string, number>();
  for (const s of stats) byDay.set(day(s.capturedAt), Number(s.payload.applications ?? 0));
  const series = [...byDay.entries()].map(([date, applications]) => ({ date, applications }));
  const latest = stats.at(-1)?.payload as Record<string, number> | undefined;
  const curve = brief?.goals.curve ?? [];
  const today = day(Math.floor(Date.now() / 1000));
  const eventDate = brief?.event.startAt.slice(0, 10) ?? today;
  const goal = brief?.goals.applications ?? 0;
  const status = latest
    ? goalStatus({ curve, goal, today, eventDate, applications: latest.applications ?? 0 })
    : null;
  const goalSeries = series.map((p) => ({
    date: p.date,
    applications:
      goalAt(curve.length ? curve : [{ date: eventDate, applications: goal }], p.date) ?? 0,
  }));

  const sources = (
    (tinyurl.at(-1)?.payload.sources ?? []) as { channelName: string; clicks: number }[]
  ).reduce<Record<string, number>>((acc, s) => {
    acc[s.channelName] = (acc[s.channelName] ?? 0) + s.clicks;
    return acc;
  }, {});
  const acquisition = (tinyurl.at(-1)?.payload.acquisition ?? null) as {
    channels: { name: string; count: number }[];
  } | null;
  const channels = Object.entries(sources).map(([name, clicks]) => {
    const applications = acquisition?.channels.find((c) => c.name === name)?.count ?? null;
    return {
      name,
      clicks,
      applications,
      rate: applications !== null && clicks ? applications / clicks : null,
    };
  });

  const adsTotals = (snaps: typeof xAds) => {
    const rows = snaps.flatMap(
      (s) => (s.payload.rows ?? []) as { spendYen: number; clicks: number; impressions: number }[],
    );
    const spend = rows.reduce((n, r) => n + r.spendYen, 0);
    const clicks = rows.reduce((n, r) => n + r.clicks, 0);
    return {
      spend,
      clicks,
      impressions: rows.reduce((n, r) => n + r.impressions, 0),
      cpc: clicks ? Math.round(spend / clicks) : null,
    };
  };
  const now = Math.floor(Date.now() / 1000);
  return {
    applications: latest ?? null,
    status,
    series,
    goalSeries,
    channels,
    ads: { x: adsTotals(xAds), ig: adsTotals(igAds) },
    flights: flights.map((f) => ({
      id: f.id,
      medium: f.medium,
      name: f.name,
      plannedYen: f.plannedYen,
      actualYen: f.actualYen,
    })),
    split: {
      planned: xIgSplit(flights, constants.budget.xIgRatioRange, "plannedYen"),
      actual: xIgSplit(flights, constants.budget.xIgRatioRange, "actualYen"),
    },
    operations: {
      inReview: drafts.filter((d) => d.status === "in_review").length,
      needsApproval: drafts.filter((d) => d.status === "needs_approval").length,
      failed: items.filter((i) => i.status === "failed").length,
      waitingReplies: items.filter((i) => i.requestStatus === "sent").length,
      overdue: items.filter(
        (i) => i.dueAt < now && !["done", "skipped", "scheduled"].includes(i.status),
      ).length,
      brokenLinks: links.filter((l) => healthState(l) === "broken").length,
    },
    perPerson: access.members.map((m) => ({
      name: m.name,
      thisWeek: items.filter(
        (i) =>
          i.assigneeUserId === m.userId &&
          i.dueAt >= now &&
          i.dueAt < now + 7 * 86400 &&
          i.status !== "done",
      ).length,
      overdue: items.filter(
        (i) =>
          i.assigneeUserId === m.userId &&
          i.dueAt < now &&
          !["done", "skipped", "scheduled"].includes(i.status),
      ).length,
    })),
  };
}
