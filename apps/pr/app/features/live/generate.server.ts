import { assetsForItem } from "~/features/assets/asset.repository.server";
import { createAndRender } from "~/features/assets/create.server";
import { latestBrief } from "~/features/briefs/brief.repository.server";
import type { CampaignAccess } from "~/features/campaigns/access.server";
import { autoFold } from "~/features/drafts/content";
import {
  appendVersion,
  createDraft,
  draftForItem,
} from "~/features/drafts/draft.repository.server";
import { itemStatusFor } from "~/features/drafts/state-machine";
import { constants, PLAYBOOK_VERSION, runChecks } from "~/features/playbook/playbook";
import { createItem, listItems, updateItem } from "~/features/schedule/item.repository.server";
import { type LivePost, livePostsFromTimetable } from "./live-posts-from-timetable";

const LOCKED = ["dispatching", "scheduled", "done", "skipped"];

/** The draft content of a live post (pr-x-post's shape), so the usual review and dispatch apply. */
export function liveDraftContent(post: LivePost) {
  return {
    channel: "x",
    posts: [
      {
        purpose: "live",
        segmentId: null,
        sessionId: post.sessionId,
        scheduleItemId: null,
        scheduledAt: new Date(post.at * 1000).toISOString(),
        text: post.text,
        ...autoFold(post.text),
        expectedReaction: "repost",
        attachment: { kind: post.card ? "image" : "none", imageSlots: null, link: null },
        speakerId: null,
        staffReminder: { text: "" },
        speakerRequest: null,
      },
    ],
    notes: null,
  };
}

/**
 * Timetable → live_post items and drafts (no LLM). Regenerating after a timetable change moves
 * and rewrites what has not gone out yet, and never touches scheduled or done posts.
 */
export async function generateLivePosts(
  env: Env,
  access: CampaignAccess,
  options: { cards: boolean },
) {
  const brief = (await latestBrief(env.DB, access.campaign.id))?.brief;
  if (!brief) return { ok: false as const, error: "先に brief を保存してください" };
  const posts = livePostsFromTimetable(brief, constants.live);
  const items = (await listItems(env.DB, access.campaign.id)).filter((i) => i.kind === "live_post");
  let created = 0;
  let updated = 0;
  let cards = 0;
  for (const post of posts) {
    const existing = items.find(
      (i) => i.sessionId === post.sessionId && i.purpose === post.purpose,
    );
    if (existing && LOCKED.includes(existing.status)) continue;
    const itemId =
      existing?.id ??
      (await createItem(
        env.DB,
        access.campaign.id,
        {
          kind: "live_post",
          channel: "x_organic",
          dueAt: post.at,
          title: post.title,
          sessionId: post.sessionId,
          purpose: post.purpose,
          requiresApproval: true,
        },
        brief,
        { derive: false },
      ));
    if (existing) {
      await updateItem(env.DB, access.campaign.id, itemId, { dueAt: post.at, title: post.title });
      updated++;
    } else created++;
    const content = liveDraftContent(post);
    const draftId =
      (await draftForItem(env.DB, itemId))?.id ??
      (await createDraft(env.DB, {
        campaignId: access.campaign.id,
        kind: "x_post",
        title: post.title,
        scheduleItemId: itemId,
      }));
    const report = runChecks({ kind: "x_post", draft: content, brief });
    await appendVersion(env.DB, draftId, {
      author: "human",
      userId: access.user.id,
      jobId: null,
      content,
      playbookVersion: PLAYBOOK_VERSION,
      checkResults: report.results,
      status: "in_review",
      itemStatus: itemStatusFor("in_review"),
    });
    if (
      options.cards &&
      post.card &&
      !(await assetsForItem(env.DB, itemId)).some((a) => a.status === "approved")
    ) {
      await createAndRender(env, {
        campaignId: access.campaign.id,
        templateId: "live-session-16x9",
        slots: post.card,
        author: "generator",
        forDraftId: draftId,
        forScheduleItemId: itemId,
      });
      cards++;
    }
  }
  return {
    ok: true as const,
    message: `実況 ${posts.length} 本（新規 ${created}、更新 ${updated}、カード ${cards} 枚）`,
  };
}
