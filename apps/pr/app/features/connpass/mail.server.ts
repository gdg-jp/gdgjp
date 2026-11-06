import { getCampaignById } from "~/features/campaigns/campaign.repository.server";
import { deliverablePost } from "~/features/dispatch/content";
import { rollup } from "~/features/dispatch/dispatch.server";
import { logDispatch } from "~/features/dispatch/log.server";
import { dueMailTargets, moveTarget } from "~/features/dispatch/target.repository.server";
import { draftForItem, latestVersion } from "~/features/drafts/draft.repository.server";
import { connpassService, parseActor } from "~/features/integrations/bindings.server";
import { linkForItem } from "~/features/links/link.repository.server";
import { withShortlink } from "~/features/links/slug";
import { connpassEventOf, submitConnpass } from "./submit.server";

/**
 * Every minute: approved connpass mails whose time has come (Tips 10: never on approval). The
 * campaign's own group mails the event's participants; another group's members would need a
 * group mail, which the connpass app cannot send yet, so that target fails asking for delegation.
 */
export async function sendDueMails(env: Env): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const target of await dueMailTargets(env.DB, Math.floor(Date.now() / 1000))) {
    if (!(await moveTarget(env.DB, target.id, ["approved"], "dispatching"))) continue;
    const fail = async (error: string) => {
      failed++;
      await moveTarget(env.DB, target.id, ["dispatching"], "failed", { error });
      await rollup(env, target.scheduleItemId);
    };
    const campaign = await getCampaignById(env.DB, target.account.campaignId);
    const actor = parseActor(target.actorSnapshot);
    const draft = await draftForItem(env.DB, target.scheduleItemId);
    const content = draft
      ? ((await latestVersion(env.DB, draft.id))?.content as { subject?: string } | null)
      : null;
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
    const link = await linkForItem(env.DB, target.scheduleItemId);
    const body = withShortlink(post.text, link?.shortUrl ?? null);
    const subject = content.subject;
    const result = await submitConnpass(env, {
      actor,
      campaign,
      itemId: target.scheduleItemId,
      targetId: target.id,
      kind: "send_event_message",
      call: () => connpassService(env).sendMessage({ actor, ...event, subject, body }),
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
