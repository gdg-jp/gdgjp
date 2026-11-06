import type { CampaignMember } from "~/features/campaigns/campaign";
import { jstDate, jstTime } from "~/features/schedule/calendar";
import type { DraftRow } from "./components/DraftTable";
import { listDrafts } from "./draft.repository.server";
import type { DraftStatus } from "./state-machine";

export async function draftRows(
  db: D1Database,
  campaignId: number,
  members: CampaignMember[],
  statuses?: DraftStatus[],
): Promise<DraftRow[]> {
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const drafts = await listDrafts(db, campaignId, statuses);
  return drafts.map((d) => ({
    id: d.id,
    kind: d.kind,
    title: d.title,
    status: d.status,
    mustFails: d.mustFails,
    version: d.currentVersion,
    updated: `${jstDate(d.updatedAt)} ${jstTime(d.updatedAt)}`,
    people: [
      d.assigneeUserId ? `担当 ${names.get(d.assigneeUserId) ?? "?"}` : null,
      d.reviewerUserId ? `レビュー ${names.get(d.reviewerUserId) ?? "?"}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
}
