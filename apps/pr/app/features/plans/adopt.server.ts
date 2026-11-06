import { latestBrief } from "~/features/briefs/brief.repository.server";
import { replacePlanFlights } from "~/features/budget/flight.repository.server";
import type { CampaignMember } from "~/features/campaigns/campaign";
import { createDerivedItem, createItem } from "~/features/schedule/item.repository.server";
import { planToItems } from "./adopt";
import { deleteUntouchedPlanItems, getPlan, markAdopted } from "./plan.repository.server";

/**
 * Adopt a plan: replace the untouched items an earlier plan created, insert this plan's items
 * (the plan already lists its derived reminders, so items are not re-derived), mark it adopted.
 * Items people created or already worked on are kept.
 */
export async function adoptPlan(
  db: D1Database,
  campaignId: number,
  version: number,
  members: CampaignMember[],
): Promise<{ created: number; removed: number; problems: string[] }> {
  const plan = await getPlan(db, campaignId, version);
  if (!plan) throw new Response(null, { status: 404 });
  const { roots, children, problems } = planToItems(plan.body, version, members);
  const removed = await deleteUntouchedPlanItems(db, campaignId);
  const ids = new Map<string, number>();
  for (const root of roots)
    ids.set(root.ref, await createItem(db, campaignId, root.input, null, { derive: false }));
  let created = roots.length;
  for (const child of children) {
    const parentId = ids.get(child.parentRef);
    if (parentId === undefined) continue;
    await createDerivedItem(db, campaignId, child.input, parentId);
    created++;
  }
  await markAdopted(db, campaignId, version);
  // Ad flights from the budget allocation, measured from the event's start.
  const brief = (await latestBrief(db, campaignId))?.brief;
  const eventAt = brief ? Math.floor(Date.parse(brief.event.startAt) / 1000) : null;
  if (eventAt)
    await replacePlanFlights(
      db,
      campaignId,
      eventAt,
      version,
      plan.body.budgetAllocation.flights.map((f) => ({
        medium: f.medium,
        name: f.name,
        startDaysBefore: f.startDaysBefore,
        endDaysBefore: f.endDaysBefore,
        plannedYen: f.plannedYen,
        phases: f.phases,
      })),
    );
  return { created, removed, problems };
}
