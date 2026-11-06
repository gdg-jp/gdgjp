import type { CampaignAccess } from "~/features/campaigns/access.server";
import type { Draft } from "~/features/drafts/draft";
import { latestVersion } from "~/features/drafts/draft.repository.server";
import { actorOf, connpassService } from "~/features/integrations/bindings.server";
import type { ConnpassPageContent } from "~/features/pages/render";
import { createItem, listItems, updateItem } from "~/features/schedule/item.repository.server";
import { NO_EVENT, connpassEventOf, submitConnpass } from "./submit.server";

/** Approving a connpass page needs somewhere to put it. */
export function pageApprovalBlockers(access: CampaignAccess, draft: Draft): string[] {
  if (draft.kind !== "connpass_page" && draft.kind !== "connpass_mail") return [];
  return connpassEventOf(access.campaign) ? [] : [NO_EVENT];
}

/**
 * The approved page goes to connpass as one update_event job (title, description, the
 * participants-only info), as the approver. The rendered HTML is the only description sent.
 */
export async function publishApprovedPage(env: Env, access: CampaignAccess, draft: Draft) {
  const event = connpassEventOf(access.campaign);
  const content = (await latestVersion(env.DB, draft.id))?.content as ConnpassPageContent | null;
  if (!event || !content?.html) return { ok: false as const, error: NO_EVENT };
  const items = await listItems(env.DB, access.campaign.id);
  const open = items.find(
    (i) => i.kind === "connpass_update" && i.status !== "done" && i.status !== "skipped",
  );
  const itemId =
    open?.id ??
    (await createItem(
      env.DB,
      access.campaign.id,
      {
        kind: "connpass_update",
        dueAt: Math.floor(Date.now() / 1000),
        title: "connpass ページを反映",
        requiresApproval: false,
      },
      null,
      { derive: false },
    ));
  const actor = actorOf(access);
  const result = await submitConnpass(env, {
    actor,
    campaign: access.campaign,
    itemId,
    kind: "update_event",
    call: () =>
      connpassService(env).updateEvent({
        actor,
        ...event,
        fields: {
          title: content.title,
          description: content.html,
          participantOnlyInfo: content.participantOnlyInfo || undefined,
        },
      }),
  });
  await updateItem(env.DB, access.campaign.id, itemId, {
    status: result.ok ? "scheduled" : "failed",
    externalRef: result.ok ? { connpassJobId: result.job.id } : null,
  });
  return result.ok
    ? { ok: true as const, message: `connpass に反映するジョブを積みました（${result.job.id}）` }
    : { ok: false as const, error: result.error };
}
