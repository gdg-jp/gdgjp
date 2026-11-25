import type { Campaign } from "~/features/campaigns/campaign";
import {
  getActorSnapshot,
  getCampaignById,
  listMembers,
} from "~/features/campaigns/campaign.repository.server";
import { approvedForSending } from "~/features/drafts/draft";
import { draftForItem, latestVersion } from "~/features/drafts/draft.repository.server";
import { parseActor } from "~/features/integrations/bindings.server";
import { versionText } from "~/features/links/create.server";
import { approvedLinkForItem } from "~/features/links/link.repository.server";
import { withShortlink } from "~/features/links/slug";
import { mention } from "~/features/notify/discord";
import { notifyChapter, template } from "~/features/notify/send.server";
import type { ScheduleItem } from "~/features/schedule/item";
import { dueItems, getItem, transitionItem } from "~/features/schedule/item.repository.server";
import { deliverablePost, jstLabel } from "./content";
import { logDispatch } from "./log.server";

const now = () => Math.floor(Date.now() / 1000);

async function handleOf(env: Env, campaignId: number, userId: string | null) {
  if (!userId) return "";
  const member = (await listMembers(env.DB, campaignId)).find((m) => m.userId === userId);
  return mention(member?.discordHandle);
}

export async function staffReminderText(env: Env, campaign: Campaign, item: ScheduleItem) {
  const parent = item.derivedFromItemId
    ? await getItem(env.DB, campaign.id, item.derivedFromItemId)
    : null;
  const draft = parent ? await draftForItem(env.DB, parent.id) : null;
  const latest = draft ? await latestVersion(env.DB, draft.id) : null;
  const post = deliverablePost(latest?.content ?? null);
  const link = parent ? await approvedLinkForItem(env.DB, parent.id) : null;
  const vars = {
    mention: await handleOf(env, campaign.id, item.assigneeUserId),
    at: jstLabel(parent?.dueAt ?? item.dueAt),
    headline: post
      ? withShortlink(post.text, link?.shortUrl ?? null).split("\n")[0]
      : parent?.title,
    image: latest?.mediaUrl ?? "",
    url: `${env.APP_URL}/c/${campaign.slug}/schedule`,
  };
  if (item.purpose === "story") return template("story", vars);
  return post?.staffReminderText
    ? `${vars.mention} ${post.staffReminderText}\n${vars.headline ?? ""}`.trim()
    : template("staff", vars);
}

export async function sendStaffReminder(
  env: Env,
  campaign: Campaign,
  item: ScheduleItem,
  manual = false,
) {
  if (
    !(await transitionItem(env.DB, item.id, ["planned", "needs_approval", "failed"], "dispatching"))
  )
    return "duplicate" as const;
  const result = await notifyChapter(env, {
    chapterId: campaign.chapterId,
    campaignId: campaign.id,
    itemId: item.id,
    key: manual ? `staff:${item.id}:manual:${Date.now()}` : `staff:${item.id}:${item.dueAt}`,
    content: await staffReminderText(env, campaign, item),
    action: "discord_staff_reminder",
  });
  await transitionItem(env.DB, item.id, ["dispatching"], result === "sent" ? "done" : "failed");
  return result;
}

async function campaignOf(env: Env, cache: Map<number, Campaign | null>, id: number) {
  if (!cache.has(id)) cache.set(id, await getCampaignById(env.DB, id));
  return cache.get(id) ?? null;
}

export async function sweepReminders(env: Env) {
  const t = now();
  const cache = new Map<number, Campaign | null>();
  const counts = { staff: 0, waiting: 0, discord: 0, review: 0, followup: 0 };

  for (const item of await dueItems(
    env.DB,
    "i.kind = 'staff_reminder' AND i.status = 'planned' AND i.due_at <= ?",
    [t],
  )) {
    const campaign = await campaignOf(env, cache, item.campaignId);
    if (!campaign) continue;
    if (campaign.autoStaffReminders && campaign.status === "active") {
      if ((await sendStaffReminder(env, campaign, item)) === "sent") counts.staff++;
    } else if (await transitionItem(env.DB, item.id, ["planned"], "needs_approval"))
      counts.waiting++;
  }

  for (const item of await dueItems(
    env.DB,
    "i.kind = 'discord_post' AND i.status = 'approved' AND i.due_at <= ?",
    [t],
  )) {
    const campaign = await campaignOf(env, cache, item.campaignId);
    if (!campaign || !(await transitionItem(env.DB, item.id, ["approved"], "dispatching")))
      continue;
    const text = await discordPostText(env, campaign, item);
    if (!text.ok) {
      await logDispatch(env.DB, {
        campaignId: campaign.id,
        itemId: item.id,
        action: "discord_post",
        ok: false,
        detail: text.error,
      });
      await transitionItem(env.DB, item.id, ["dispatching"], "failed");
      continue;
    }
    const result = await notifyChapter(env, {
      chapterId: campaign.chapterId,
      campaignId: campaign.id,
      itemId: item.id,
      key: `discord_post:${item.id}`,
      content: template("discordPost", { text: text.text }),
      action: "discord_post",
    });
    await transitionItem(env.DB, item.id, ["dispatching"], result === "sent" ? "done" : "failed");
    if (result === "sent") counts.discord++;
  }

  counts.review = await sweepReviewRequests(env, cache);

  for (const item of await dueItems(
    env.DB,
    "i.request_status = 'sent' AND i.request_followup_at IS NOT NULL AND i.request_followup_at <= ? AND i.status NOT IN ('done','skipped')",
    [t],
  )) {
    const campaign = await campaignOf(env, cache, item.campaignId);
    if (!campaign) continue;
    const result = await notifyChapter(env, {
      chapterId: campaign.chapterId,
      campaignId: campaign.id,
      itemId: item.id,
      key: `followup:${item.id}:${item.requestFollowupAt}`,
      content: template("followup", {
        mention: await handleOf(env, campaign.id, item.assigneeUserId),
        title: item.title,
        url: `${env.APP_URL}/c/${campaign.slug}/approvals`,
      }),
      action: "discord_followup",
    });
    if (result === "sent") counts.followup++;
  }
  return counts;
}

async function discordPostText(
  env: Env,
  campaign: Campaign,
  item: ScheduleItem,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const draft = await draftForItem(env.DB, item.id);
  if (!draft) return { ok: true, text: item.note ?? item.title };
  if (!approvedForSending(draft) || draft.approvedVersion === null)
    return { ok: false, error: "not_approved" };
  const actor = parseActor(await getActorSnapshot(env.DB, campaign.id));
  const at = { draftId: draft.id, version: draft.approvedVersion };
  return versionText(env, actor, campaign, item, at);
}

async function sweepReviewRequests(env: Env, cache: Map<number, Campaign | null>) {
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.campaign_id, d.title, d.current_version, d.reviewer_user_id FROM drafts d
     LEFT JOIN notifications_sent n ON n.key = 'review:' || d.id || ':' || d.current_version
     WHERE d.status = 'in_review' AND n.key IS NULL LIMIT 50`,
  ).all<{
    id: number;
    campaign_id: number;
    title: string;
    current_version: number;
    reviewer_user_id: string | null;
  }>();
  let sent = 0;
  for (const row of results) {
    const campaign = await campaignOf(env, cache, row.campaign_id);
    if (!campaign) continue;
    const members = await listMembers(env.DB, campaign.id);
    const reviewers = row.reviewer_user_id
      ? members.filter((m) => m.userId === row.reviewer_user_id)
      : members.filter((m) => m.roles.includes("reviewer"));
    const result = await notifyChapter(env, {
      chapterId: campaign.chapterId,
      campaignId: campaign.id,
      itemId: null,
      key: `review:${row.id}:${row.current_version}`,
      content: template("review", {
        mention: reviewers
          .map((m) => mention(m.discordHandle))
          .filter(Boolean)
          .join(" "),
        title: row.title,
        url: `${env.APP_URL}/c/${campaign.slug}/drafts/${row.id}`,
      }),
      action: "discord_review_request",
    });
    if (result === "sent") sent++;
  }
  return sent;
}
