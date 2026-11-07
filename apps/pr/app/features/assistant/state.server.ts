import type { Brief } from "~/features/briefs/brief";
import { latestBrief } from "~/features/briefs/brief.repository.server";
import type { Campaign } from "~/features/campaigns/campaign";
import { listDrafts } from "~/features/drafts/draft.repository.server";
import { listJobs } from "~/features/jobs/job.repository.server";
import type { JobType } from "~/features/jobs/shared";
import { goalStatus } from "~/features/metrics/goal";
import { latestSnapshot } from "~/features/metrics/snapshot.repository.server";
import { listPlans } from "~/features/plans/plan.repository.server";
import { jstDate, jstTime } from "~/features/schedule/calendar";
import { listItems } from "~/features/schedule/item.repository.server";
import { type Phase, briefGaps, phaseOf } from "./state";

export const isoJst = (epoch: number) => `${jstDate(epoch)}T${jstTime(epoch)}:00+09:00`;

export type CampaignState = {
  campaign: {
    name: string;
    slug: string;
    base: string;
    status: Campaign["status"];
    eventAt: string | null;
  };
  phase: Phase;
  brief: { exists: boolean; version: number; gaps: string[] };
  plan: { version: number; adopted: boolean; mustFails: number } | null;
  schedule: {
    total: number;
    byStatus: Record<string, number>;
    upcoming: {
      id: number;
      kind: string;
      title: string;
      dueAt: string;
      status: string;
      hasDraft: boolean;
      blocked: boolean;
    }[];
  };
  drafts: { id: number; kind: string; title: string; status: string; mustFails: number }[];
  applications: { count: number; goal: number; diff: number; daysLeft: number } | null;
  jobs: { id: string; type: JobType; status: string }[];
  now: string;
};

/** One read of a campaign for the assistant's bundle and the event page's status panel. */
export async function campaignState(
  env: Env,
  campaign: Campaign,
): Promise<{ state: CampaignState; brief: Brief | null }> {
  const id = campaign.id;
  const [stored, plans, items, drafts, jobs, stats] = await Promise.all([
    latestBrief(env.DB, id),
    listPlans(env.DB, id),
    listItems(env.DB, id),
    listDrafts(env.DB, id),
    listJobs(env.DB, { campaignId: id, limit: 30 }),
    latestSnapshot(env.DB, id, "connpass_stats"),
  ]);
  const brief = stored?.brief ?? null;
  const now = Math.floor(Date.now() / 1000);
  const latestPlan = plans[0] ?? null;
  const adopted = plans.some((p) => p.status === "adopted");
  const byStatus: Record<string, number> = {};
  for (const item of items) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
  const gaps = briefGaps(brief);
  const startAt = brief?.event.startAt ? Date.parse(brief.event.startAt) / 1000 : null;
  const endAt = brief?.event.endAt ? Date.parse(brief.event.endAt) / 1000 : null;
  const applications = Number(stats?.payload.applications ?? Number.NaN);
  const goal = brief?.goals.applications ?? 0;
  const today = jstDate(now);
  return {
    brief,
    state: {
      campaign: {
        name: campaign.name,
        slug: campaign.slug,
        base: `/c/${campaign.slug}`,
        status: campaign.status,
        eventAt: campaign.eventAt ? isoJst(campaign.eventAt) : null,
      },
      phase: phaseOf({
        status: campaign.status,
        briefReady: gaps.length === 0,
        planAdopted: adopted,
        eventAt: startAt ?? campaign.eventAt,
        endAt: Number.isNaN(endAt) ? null : endAt,
        now,
      }),
      brief: { exists: !!stored, version: stored?.version ?? 0, gaps },
      plan: latestPlan
        ? {
            version: latestPlan.version,
            adopted: latestPlan.status === "adopted",
            mustFails: latestPlan.checkResults.filter(
              (c) => c.strength === "MUST" && c.status === "fail",
            ).length,
          }
        : null,
      schedule: {
        total: items.length,
        byStatus,
        upcoming: items
          .filter((i) => i.dueAt >= now - 86_400 && i.status !== "done" && i.status !== "skipped")
          .slice(0, 25)
          .map((i) => ({
            id: i.id,
            kind: i.kind,
            title: i.title,
            dueAt: isoJst(i.dueAt),
            status: i.status,
            hasDraft: drafts.some((d) => d.scheduleItemId === i.id),
            blocked: i.blockedBy.length > 0,
          })),
      },
      drafts: drafts
        .filter((d) => ["generating", "in_review", "needs_approval"].includes(d.status))
        .slice(0, 20)
        .map((d) => ({
          id: d.id,
          kind: d.kind,
          title: d.title,
          status: d.status,
          mustFails: d.mustFails,
        })),
      applications:
        stats && Number.isFinite(applications) && brief
          ? {
              count: applications,
              goal,
              ...(({ diff, daysLeft }) => ({ diff, daysLeft }))(
                goalStatus({
                  curve: brief.goals.curve ?? [],
                  goal,
                  today,
                  eventDate: brief.event.startAt.slice(0, 10) || today,
                  applications,
                }),
              ),
            }
          : null,
      jobs: jobs
        .filter((j) => j.status === "queued" || j.status === "leased")
        .map((j) => ({ id: j.id, type: j.type, status: j.status })),
      now: isoJst(now),
    },
  };
}
