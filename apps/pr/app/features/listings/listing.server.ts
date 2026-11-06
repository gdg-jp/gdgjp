import type { ListingPlatform } from "@gdgjp/gdg-lib";
import { latestBrief } from "~/features/briefs/brief.repository.server";
import type { CampaignAccess } from "~/features/campaigns/access.server";
import { submitConnpass } from "~/features/connpass/submit.server";
import type { Draft } from "~/features/drafts/draft";
import {
  appendVersion,
  createDraft,
  draftForItem,
  latestVersion,
  listDrafts,
} from "~/features/drafts/draft.repository.server";
import { actorOf, connpassService } from "~/features/integrations/bindings.server";
import { approvedCopy } from "~/features/jobs/bundle.server";
import { PLAYBOOK_VERSION } from "~/features/playbook/playbook";
import type { ScheduleItem } from "~/features/schedule/item";
import { getItem, listItems, updateItem } from "~/features/schedule/item.repository.server";
import { LISTING_KIND_PLATFORM, type ListingContent, listingFromBrief } from "./from-brief";

export const isListingKind = (kind: string) => kind in LISTING_KIND_PLATFORM;

export async function listingTargets(db: D1Database, campaignId: number) {
  const { results } = await db
    .prepare("SELECT platform, external_id, chapter_id FROM listing_targets WHERE campaign_id = ?")
    .bind(campaignId)
    .all<{ platform: ListingPlatform; external_id: string; chapter_id: number }>();
  return results.map((r) => ({
    platform: r.platform,
    externalId: r.external_id,
    chapterId: r.chapter_id,
  }));
}

export async function setListingTarget(
  db: D1Database,
  campaignId: number,
  target: { platform: ListingPlatform; externalId: string | null; chapterId: number },
  userId: string,
) {
  if (!target.externalId) {
    await db
      .prepare("DELETE FROM listing_targets WHERE campaign_id = ? AND platform = ?")
      .bind(campaignId, target.platform)
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO listing_targets (campaign_id, platform, external_id, chapter_id, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (campaign_id, platform) DO UPDATE SET external_id = excluded.external_id,
         chapter_id = excluded.chapter_id, updated_by = excluded.updated_by, updated_at = unixepoch()`,
    )
    .bind(campaignId, target.platform, target.externalId, target.chapterId, userId)
    .run();
}

/** Listing drafts need no runner: they are mapped from the brief, then a person edits them. */
export async function createListingDrafts(env: Env, access: CampaignAccess, items: ScheduleItem[]) {
  const brief = (await latestBrief(env.DB, access.campaign.id))?.brief;
  if (!brief) return 0;
  const copy = (await approvedCopy(env.DB, access.campaign.id)) as {
    candidates?: { connpassTitle?: string }[];
  } | null;
  const page = (await listDrafts(env.DB, access.campaign.id)).find(
    (d) => d.kind === "connpass_page",
  );
  const pageSummary = page
    ? ((await latestVersion(env.DB, page.id))?.content as { summary?: string } | null)?.summary
    : null;
  let made = 0;
  for (const item of items.filter((i) => isListingKind(i.kind))) {
    const content = listingFromBrief({
      platform: LISTING_KIND_PLATFORM[item.kind] as ListingPlatform,
      brief,
      organizer: access.campaign.chapterSlug,
      copyTitle: copy?.candidates?.[0]?.connpassTitle ?? null,
      pageSummary: pageSummary ?? null,
    });
    const draftId =
      (await draftForItem(env.DB, item.id))?.id ??
      (await createDraft(env.DB, {
        campaignId: access.campaign.id,
        kind: "listing",
        title: item.title,
        scheduleItemId: item.id,
      }));
    await appendVersion(env.DB, draftId, {
      author: "human",
      userId: access.user.id,
      jobId: null,
      content,
      playbookVersion: PLAYBOOK_VERSION,
      checkResults: [],
      status: "in_review",
      itemStatus: "in_review",
    });
    made++;
  }
  return made;
}

/** Findy's submission cannot be taken back: one per campaign. */
export async function listingApprovalBlockers(env: Env, access: CampaignAccess, draft: Draft) {
  if (draft.kind !== "listing" || !draft.scheduleItemId) return [];
  const item = await getItem(env.DB, access.campaign.id, draft.scheduleItemId);
  if (item?.kind !== "findy_submit") return [];
  const done = (await listItems(env.DB, access.campaign.id)).some(
    (i) =>
      i.kind === "findy_submit" &&
      i.id !== item.id &&
      (i.status === "done" || i.status === "scheduled"),
  );
  return done
    ? [
        "Findy Conference にはこのキャンペーンでもう送っています（取り消せないので 2 回目は送りません）",
      ]
    : [];
}

/**
 * After approval: through the connpass app's listing job when the platform is configured and
 * supported; otherwise the text stays here for a person to paste, and they mark it done.
 */
export async function afterListingApproval(env: Env, access: CampaignAccess, draft: Draft) {
  const content = (await latestVersion(env.DB, draft.id))?.content as ListingContent | null;
  if (!content || !draft.scheduleItemId)
    return { ok: false as const, error: "掲載内容がありません" };
  const target = (await listingTargets(env.DB, access.campaign.id)).find(
    (t) => t.platform === content.platform,
  );
  if (!target)
    return {
      ok: true as const,
      message: "掲載先が未設定です。下の文面をコピーして手で掲載し「手で掲載した」を押してください",
    };
  const actor = actorOf(access);
  const itemId = draft.scheduleItemId;
  const result = await submitConnpass(env, {
    actor,
    campaign: access.campaign,
    itemId,
    kind: "create_listing",
    call: () =>
      connpassService(env).createListing({
        actor,
        platform: content.platform,
        targetId: target.externalId,
        listing: content.listing,
      }),
  });
  if (result.ok) {
    await updateItem(env.DB, access.campaign.id, itemId, {
      status: "scheduled",
      externalRef: { connpassJobId: result.job.id },
    });
    return { ok: true as const, message: `掲載のジョブを積みました（${result.job.id}）` };
  }
  return result.code === "not_supported"
    ? {
        ok: true as const,
        message:
          "この媒体の自動掲載はまだありません。文面をコピーして手で掲載し「手で掲載した」を押してください",
      }
    : { ok: false as const, error: result.error };
}

/** A person listed it by hand: the item is done, with the listing's URL. */
export async function markListedByHand(
  env: Env,
  access: CampaignAccess,
  draft: Draft,
  url: string,
) {
  if (!draft.scheduleItemId || draft.status !== "approved")
    return { ok: false as const, error: "承認してから完了にしてください" };
  if (url && !/^https?:\/\//.test(url))
    return { ok: false as const, error: "URL を入れてください" };
  await updateItem(env.DB, access.campaign.id, draft.scheduleItemId, {
    status: "done",
    externalRef: { url: url || null, manual: true },
  });
  return { ok: true as const, message: "掲載済みにしました" };
}
