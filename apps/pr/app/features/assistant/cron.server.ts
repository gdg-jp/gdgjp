import { latestBrief } from "~/features/briefs/brief.repository.server";
import type { Campaign } from "~/features/campaigns/campaign";
import {
  listCampaignsForChapters,
  listMembers,
} from "~/features/campaigns/campaign.repository.server";
import { listDrafts } from "~/features/drafts/draft.repository.server";
import { EnqueueError, enqueueDrafts } from "~/features/jobs/enqueue.server";
import { openJobs } from "~/features/jobs/job.repository.server";
import { mention } from "~/features/notify/discord";
import { notifyChapter, template } from "~/features/notify/send.server";
import { adoptedPlan } from "~/features/plans/plan.repository.server";
import { pendingConditions } from "~/features/schedule/blocked-by";
import { jstDate, jstTime } from "~/features/schedule/calendar";
import { listItems } from "~/features/schedule/item.repository.server";
import { KIND_LABELS } from "~/features/schedule/kinds";
import { assistantSettings, digestChapters } from "~/features/settings/chapter-settings.server";
import { postEvent } from "./events.server";
import { lastMessages } from "./message.repository.server";

/** Drafts for posts and mails are queued this long before they go out. */
export const DRAFT_LEAD_SECONDS = 7 * 86_400;
const AUTO_DRAFT_KINDS = ["x_post", "ig_post", "connpass_mail"];
const DEADLINE_KINDS = ["x_post", "ig_post", "connpass_mail"];
const OPEN = ["planned", "drafting", "in_review", "needs_approval"];

const at = (epoch: number) => `${jstDate(epoch).slice(5).replace("-", "/")} ${jstTime(epoch)}`;

async function liveCampaigns(db: D1Database): Promise<Campaign[]> {
  return (await listCampaignsForChapters(db, [], true)).filter((c) => c.status !== "closed");
}

/**
 * Hourly: post and mail items whose time is within a week and that have no draft get one, for
 * campaigns with an adopted plan in chapters that let the assistant act ("auto").
 */
export async function queueDueDrafts(env: Env, now = Math.floor(Date.now() / 1000)) {
  let queued = 0;
  for (const campaign of await liveCampaigns(env.DB)) {
    if ((await assistantSettings(env.DB, campaign.chapterId)).mode !== "auto") continue;
    if (!(await adoptedPlan(env.DB, campaign.id))) continue;
    const [items, drafts, pages, stored] = await Promise.all([
      listItems(env.DB, campaign.id),
      listDrafts(env.DB, campaign.id),
      openJobs(env.DB, campaign.id, "page"),
      latestBrief(env.DB, campaign.id),
    ]);
    const status = new Map(items.map((i) => [i.id, i.status]));
    const drafted = new Set(drafts.map((d) => d.scheduleItemId));
    const mailing = new Set(
      pages.map((j) => (j.payload as { scheduleItemId?: number }).scheduleItemId),
    );
    const due = items.filter(
      (i) =>
        AUTO_DRAFT_KINDS.includes(i.kind) &&
        i.status === "planned" &&
        i.dueAt > now &&
        i.dueAt <= now + DRAFT_LEAD_SECONDS &&
        !drafted.has(i.id) &&
        !mailing.has(i.id) &&
        pendingConditions(i.blockedBy, {
          brief: stored?.brief ?? null,
          itemStatus: (id) => status.get(id),
          now: now * 1000,
        }).length === 0,
    );
    if (!due.length) continue;
    try {
      await enqueueDrafts(
        env.DB,
        campaign.id,
        campaign.createdBy,
        due.map((i) => i.id),
      );
    } catch (error) {
      if (error instanceof EnqueueError) continue;
      throw error;
    }
    queued += due.length;
    await postEvent(
      env.DB,
      campaign.id,
      `auto-drafts:${jstDate(now)}:${due.map((i) => i.id).join(",")}`,
      `1 週間以内の予定 ${due.length} 件の下書きを作り始めました: ${due
        .slice(0, 5)
        .map((i) => `${at(i.dueAt)}「${i.title}」`)
        .join("、")}${due.length > 5 ? " ほか" : ""}`,
    );
  }
  return { queued };
}

/** Hourly: a post or mail due within 24 hours and not yet approved is flagged once. */
export async function flagDeadlines(env: Env, now = Math.floor(Date.now() / 1000)) {
  let flagged = 0;
  for (const campaign of await liveCampaigns(env.DB)) {
    const items = (await listItems(env.DB, campaign.id)).filter(
      (i) =>
        DEADLINE_KINDS.includes(i.kind) &&
        OPEN.includes(i.status) &&
        i.dueAt > now &&
        i.dueAt <= now + 86_400,
    );
    if (!items.length) continue;
    const members = await listMembers(env.DB, campaign.id);
    for (const item of items) {
      const posted = await postEvent(
        env.DB,
        campaign.id,
        `due:${item.id}:${item.dueAt}`,
        `「${item.title}」（${KIND_LABELS[item.kind]}）は ${at(item.dueAt)} の予定ですが、まだ承認されていません。`,
        [
          {
            type: "open_page",
            label: "予定表を開く",
            path: `/c/${campaign.slug}/schedule`,
            status: "proposed",
          },
        ],
      );
      if (!posted) continue;
      flagged += 1;
      const owner = members.find((m) => m.userId === (item.reviewerUserId ?? item.assigneeUserId));
      await notifyChapter(env, {
        chapterId: campaign.chapterId,
        campaignId: campaign.id,
        itemId: item.id,
        key: `approval-due:${item.id}:${item.dueAt}`,
        action: "approval_due",
        content: template("approvalDue", {
          mention: mention(owner?.discordHandle),
          title: item.title,
          at: at(item.dueAt),
          url: `${env.APP_URL}/c/${campaign.slug}`,
        }),
      });
    }
  }
  return { flagged };
}

/** At 09:00 JST: each live campaign with something today or waiting sends one Discord message. */
export async function morningDigest(env: Env, now = Math.floor(Date.now() / 1000)) {
  if (jstTime(now).slice(0, 2) !== "09") return { sent: 0 };
  const campaigns = await liveCampaigns(env.DB);
  const on = new Set(await digestChapters(env.DB, [...new Set(campaigns.map((c) => c.chapterId))]));
  const last = await lastMessages(
    env.DB,
    campaigns.map((c) => c.id),
  );
  const today = jstDate(now);
  let sent = 0;
  for (const campaign of campaigns) {
    if (!on.has(campaign.chapterId)) continue;
    const [items, drafts] = await Promise.all([
      listItems(env.DB, campaign.id),
      listDrafts(env.DB, campaign.id, ["in_review", "needs_approval"]),
    ]);
    const todays = items
      .filter((i) => jstDate(i.dueAt) === today && i.derivedFromItemId === null)
      .filter((i) => i.status !== "skipped")
      .map((i) => `・${jstTime(i.dueAt)} ${KIND_LABELS[i.kind]}「${i.title}」`);
    const waiting = [
      ...drafts.map(
        (d) => `・${d.status === "needs_approval" ? "承認待ち" : "レビュー待ち"}「${d.title}」`,
      ),
      ...(last.get(campaign.id)?.author === "assistant" && last.get(campaign.id)?.questions.length
        ? ["・秘書からの質問"]
        : []),
    ];
    if (!todays.length && !waiting.length) continue;
    const result = await notifyChapter(env, {
      chapterId: campaign.chapterId,
      campaignId: campaign.id,
      itemId: null,
      key: `digest:${today}:${campaign.id}`,
      action: "digest",
      content: template("digest", {
        campaign: campaign.name,
        today: todays.slice(0, 10).join("\n"),
        waiting: waiting.slice(0, 10).join("\n"),
        url: `${env.APP_URL}/c/${campaign.slug}`,
      }),
    });
    if (result === "sent") sent += 1;
  }
  return { sent };
}
