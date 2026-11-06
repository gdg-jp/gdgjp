import type { ConnpassJobSummary, PrActor, PrRpcResult } from "@gdgjp/gdg-lib";
import type { Campaign } from "~/features/campaigns/campaign";
import { logDispatch } from "~/features/dispatch/log.server";
import { callRpc } from "~/features/integrations/bindings.server";
import { type ConnpassJobKind, recordConnpassJob } from "./job-ledger.server";

export type ConnpassEvent = { groupSlug: string; eventId: string };

/** The campaign's connpass event; pr never creates one (a person does, then enters its id). */
export function connpassEventOf(campaign: Campaign): ConnpassEvent | null {
  return campaign.connpassGroupSlug && campaign.connpassEventId
    ? { groupSlug: campaign.connpassGroupSlug, eventId: campaign.connpassEventId }
    : null;
}

export const NO_EVENT = "設定で connpass のグループとイベント ID を入れてください";

/** Submit one connpass job as `actor`, keep it in the ledger and the dispatch log. */
export async function submitConnpass(
  env: Env,
  input: {
    actor: PrActor;
    campaign: Campaign;
    itemId: number | null;
    targetId?: number | null;
    kind: ConnpassJobKind;
    call: () => Promise<PrRpcResult<{ job: ConnpassJobSummary }>>;
  },
): Promise<{ ok: true; job: ConnpassJobSummary } | { ok: false; code: string; error: string }> {
  const result = await callRpc(input.call);
  await logDispatch(env.DB, {
    campaignId: input.campaign.id,
    itemId: input.itemId,
    action: `connpass_${input.kind}`,
    ok: result.ok,
    detail: result.ok ? result.job.id : `${result.code} ${result.message ?? ""}`.trim(),
  });
  if (!result.ok)
    return { ok: false, code: result.code, error: `connpass に送れませんでした（${result.code}）` };
  await recordConnpassJob(env.DB, {
    jobId: result.job.id,
    campaignId: input.campaign.id,
    itemId: input.itemId,
    targetId: input.targetId ?? null,
    kind: input.kind,
    actorSnapshot: JSON.stringify(input.actor),
  });
  return { ok: true, job: result.job };
}
