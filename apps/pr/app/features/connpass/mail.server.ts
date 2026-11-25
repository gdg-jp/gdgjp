import { getCampaignById } from "~/features/campaigns/campaign.repository.server";
import { deliverablePost } from "~/features/dispatch/content";
import { rollup } from "~/features/dispatch/dispatch.server";
import { logDispatch } from "~/features/dispatch/log.server";
import {
  claimApprovedTarget,
  dueMailTargets,
  moveTarget,
} from "~/features/dispatch/target.repository.server";
import { getVersion } from "~/features/drafts/draft.repository.server";
import { connpassService, parseActor } from "~/features/integrations/bindings.server";
import { approvedVersionText } from "~/features/links/create.server";
import { getItem } from "~/features/schedule/item.repository.server";
import { connpassEventOf, submitConnpass } from "./submit.server";

export async function sendDueMails(env: Env): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const target of await dueMailTargets(env.DB, Math.floor(Date.now() / 1000))) {
    if (!target.approvedVersion) continue;
    const at = { targetId: target.id, draftId: target.draftId, version: target.approvedVersion };
    const claimed = await claimApprovedTarget(env.DB, at);
    if (!claimed) continue;
    const fail = async (error: string) => {
      failed++;
      await moveTarget(env.DB, target.id, ["dispatching"], "failed", { error });
      await rollup(env, target.scheduleItemId);
    };
    const campaign = await getCampaignById(env.DB, target.account.campaignId);
    const actor = parseActor(target.actorSnapshot);
    const content = (await getVersion(env.DB, at.draftId, at.version))?.content as {
      subject?: string;
    } | null;
    const post = deliverablePost(content);
    if (!campaign || !actor || !post || !content?.subject) {
      await logDispatch(env.DB, {
        campaignId: target.account.campaignId,
        itemId: target.scheduleItemId,
        action: "connpass_mail",
        ok: false,
        detail: actor ? "no_content" : "no_actor",
      });
      await fail(actor ? "送る本文がありません" : "承認者の情報がありません");
      continue;
    }
    const event = connpassEventOf(campaign);
    if (!event || target.account.externalId !== event.groupSlug) {
      await fail("このグループのメンバー宛のメールはまだ送れません。依頼に回してください");
      continue;
    }
    const item = await getItem(env.DB, campaign.id, target.scheduleItemId);
    const body = item ? await approvedVersionText(env, actor, campaign, item, claimed) : null;
    if (!body?.ok) {
      await fail(body?.error ?? "送る本文がありません");
      continue;
    }
    const subject = content.subject;
    const result = await submitConnpass(env, {
      actor,
      campaign,
      itemId: target.scheduleItemId,
      targetId: target.id,
      kind: "send_event_message",
      call: () => connpassService(env).sendMessage({ actor, ...event, subject, body: body.text }),
    });
    if (!result.ok) {
      await fail(result.error);
      continue;
    }
    await moveTarget(env.DB, target.id, ["dispatching"], "scheduled", {
      externalRef: { connpassJobId: result.job.id },
      error: null,
    });
    await rollup(env, target.scheduleItemId);
    sent++;
  }
  return { sent, failed };
}
