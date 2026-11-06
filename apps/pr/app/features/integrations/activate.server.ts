import { latestBrief } from "~/features/briefs/brief.repository.server";
import type { CampaignAccess } from "~/features/campaigns/access.server";
import {
  setActorSnapshot,
  setTinyurlCampaign,
  updateCampaign,
} from "~/features/campaigns/campaign.repository.server";
import { logDispatch } from "~/features/dispatch/log.server";
import { saveCampaignChannel } from "~/features/links/link.repository.server";
import { adoptedPlan } from "~/features/plans/plan.repository.server";
import { constants, channelLabel } from "~/features/playbook/playbook";
import { actorOf, callRpc, tinyurlService } from "./bindings.server";

/** tinyurl codes: lowercase, digits, `_` and `-`, at most 32. */
export const tinyurlCode = (raw: string) =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 32)
    .replace(/[-_]+$/, "");

/** The adopted plan's channels, or the whole catalog when there is no plan yet. */
export async function campaignChannelCodes(db: D1Database, campaignId: number): Promise<string[]> {
  const plan = await adoptedPlan(db, campaignId);
  const adopted = plan?.body.channelMix.filter((c) => c.adopt).map((c) => c.channel) ?? [];
  return adopted.length ? [...new Set(adopted)] : [...constants.channelCatalog];
}

/**
 * draft → active: the tinyurl campaign and one channel per PR channel (idempotent, so a failure
 * can be retried), then the actor snapshot cron uses for tinyurl.
 */
export async function activateCampaign(
  env: Env,
  access: CampaignAccess,
): Promise<{ ok: true; channels: number } | { ok: false; error: string }> {
  const { campaign } = access;
  const actor = actorOf(access);
  const brief = (await latestBrief(env.DB, campaign.id))?.brief ?? null;
  const ensured = await callRpc(() =>
    tinyurlService(env).ensureCampaign({
      actor,
      chapterId: campaign.chapterId,
      code: tinyurlCode(campaign.slug),
      name: campaign.name,
      defaultDestinationUrl: brief?.event.connpassUrl ?? null,
    }),
  );
  await logDispatch(env.DB, {
    campaignId: campaign.id,
    itemId: null,
    action: "tinyurl_campaign",
    ok: ensured.ok,
    detail: ensured.ok ? String(ensured.campaignId) : `${ensured.code} ${ensured.message ?? ""}`,
  });
  if (!ensured.ok)
    return { ok: false, error: `url.gdgs.jp のキャンペーンを作れませんでした（${ensured.code}）` };
  await setTinyurlCampaign(env.DB, campaign.id, ensured.campaignId);
  const codes = await campaignChannelCodes(env.DB, campaign.id);
  for (const channel of codes) {
    const created = await callRpc(() =>
      tinyurlService(env).ensureChannel({
        actor,
        campaignId: ensured.campaignId,
        code: tinyurlCode(channel),
        name: channelLabel(channel),
      }),
    );
    if (!created.ok)
      return { ok: false, error: `チャネル ${channel} を作れませんでした（${created.code}）` };
    await saveCampaignChannel(env.DB, campaign.id, channel, created.channelId);
  }
  await setActorSnapshot(env.DB, campaign.id, JSON.stringify(actor));
  await updateCampaign(env.DB, campaign.id, { status: "active" });
  return { ok: true, channels: codes.length };
}
