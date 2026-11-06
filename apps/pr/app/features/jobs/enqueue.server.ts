import type { Brief } from "~/features/briefs/brief";
import { latestBrief } from "~/features/briefs/brief.repository.server";
import { createDraft, draftForItem } from "~/features/drafts/draft.repository.server";
import { pendingConditions } from "~/features/schedule/blocked-by";
import { listItems } from "~/features/schedule/item.repository.server";
import { DRAFTABLE_KINDS } from "~/features/schedule/kinds";
import { insertJob, openJobs } from "./job.repository.server";

export class EnqueueError extends Error {}

async function requireBrief(
  db: D1Database,
  campaignId: number,
): Promise<{ version: number; brief: Brief }> {
  const stored = await latestBrief(db, campaignId);
  if (!stored) throw new EnqueueError("先に brief を保存してください");
  return stored;
}

export async function enqueuePlan(
  db: D1Database,
  campaignId: number,
  userId: string,
  instructions?: string,
): Promise<string> {
  const { version } = await requireBrief(db, campaignId);
  if ((await openJobs(db, campaignId, "plan")).length)
    throw new EnqueueError("計画のジョブがもう動いています");
  return insertJob(db, {
    campaignId,
    payload: { type: "plan", briefVersion: version, instructions },
    requestedBy: userId,
  });
}

export async function enqueueCopy(
  db: D1Database,
  campaignId: number,
  userId: string,
  options: {
    count?: number;
    planVersion?: number | null;
    draftId?: number | null;
    instructions?: string;
  } = {},
): Promise<string> {
  const { version } = await requireBrief(db, campaignId);
  return insertJob(db, {
    campaignId,
    payload: {
      type: "copy",
      briefVersion: version,
      count: options.count ?? 5,
      planVersion: options.planVersion ?? null,
      draftId: options.draftId ?? null,
      instructions: options.instructions,
    },
    requestedBy: userId,
  });
}

/**
 * Queue post drafts for schedule items. Refuses items whose blocked_by conditions do not hold
 * (ANNOUNCE-AFTER-CONFIRMED) and kinds that are not posts. The drafts appear at once as
 * "generating" so the schedule shows work is in progress.
 */
export async function enqueuePosts(
  db: D1Database,
  campaignId: number,
  userId: string,
  itemIds: number[],
  instructions?: string,
): Promise<string[]> {
  const { version, brief } = await requireBrief(db, campaignId);
  const items = await listItems(db, campaignId);
  const status = new Map(items.map((i) => [i.id, i.status]));
  const chosen = items.filter((i) => itemIds.includes(i.id));
  if (chosen.length === 0) throw new EnqueueError("アイテムを選んでください");
  const problems: string[] = [];
  for (const item of chosen) {
    if (
      !DRAFTABLE_KINDS.includes(item.kind) ||
      !["x_post", "ig_post", "live_post"].includes(item.kind)
    )
      problems.push(`「${item.title}」は投稿ではない`);
    const pending = pendingConditions(item.blockedBy, {
      brief,
      itemStatus: (id) => status.get(id),
      now: Date.now(),
    });
    if (pending.length) problems.push(`「${item.title}」は条件待ち（${pending.join(", ")}）`);
    if (["approved", "dispatching", "scheduled", "done"].includes(item.status))
      problems.push(`「${item.title}」はもう承認済み`);
  }
  if (problems.length) throw new EnqueueError(problems.join(" / "));
  const jobs: string[] = [];
  for (const channel of ["x", "ig"] as const) {
    const group = chosen.filter((i) =>
      channel === "ig" ? i.kind === "ig_post" : i.kind !== "ig_post",
    );
    for (let i = 0; i < group.length; i += 10) {
      const batch = group.slice(i, i + 10);
      for (const item of batch) {
        if (!(await draftForItem(db, item.id))) {
          await createDraft(db, {
            campaignId,
            kind: channel === "ig" ? "ig_post" : "x_post",
            title: item.title,
            scheduleItemId: item.id,
            assigneeUserId: item.assigneeUserId,
            reviewerUserId: item.reviewerUserId,
          });
        }
        await db
          .prepare(
            "UPDATE schedule_items SET status = 'drafting' WHERE id = ? AND status = 'planned'",
          )
          .bind(item.id)
          .run();
      }
      jobs.push(
        await insertJob(db, {
          campaignId,
          payload: {
            type: "post",
            briefVersion: version,
            scheduleItemIds: batch.map((b) => b.id),
            channel,
            instructions,
          },
          requestedBy: userId,
        }),
      );
    }
  }
  return jobs;
}

/** A connpass page (one per campaign) or one connpass mail (for its schedule item). */
export async function enqueuePage(
  db: D1Database,
  campaignId: number,
  userId: string,
  input: {
    kind: "connpass_page" | "connpass_mail";
    scheduleItemId?: number;
    draftId?: number;
    imageUrls?: Record<string, string>;
    instructions?: string;
  },
): Promise<string> {
  const { version } = await requireBrief(db, campaignId);
  if (input.kind === "connpass_mail" && !input.scheduleItemId)
    throw new EnqueueError("メールはスケジュールの connpass メールから作ります");
  return insertJob(db, {
    campaignId,
    payload: { type: "page", briefVersion: version, ...input },
    requestedBy: userId,
  });
}

/** The schedule page's "ask the runner": posts in batches, each connpass mail on its own. */
export async function enqueueDrafts(
  db: D1Database,
  campaignId: number,
  userId: string,
  itemIds: number[],
  instructions?: string,
): Promise<string[]> {
  const items = (await listItems(db, campaignId)).filter((i) => itemIds.includes(i.id));
  const mails = items.filter((i) => i.kind === "connpass_mail");
  const posts = items.filter((i) => i.kind !== "connpass_mail").map((i) => i.id);
  const jobs = posts.length ? await enqueuePosts(db, campaignId, userId, posts, instructions) : [];
  for (const mail of mails)
    jobs.push(
      await enqueuePage(db, campaignId, userId, {
        kind: "connpass_mail",
        scheduleItemId: mail.id,
        instructions,
      }),
    );
  if (!jobs.length) throw new EnqueueError("アイテムを選んでください");
  return jobs;
}
