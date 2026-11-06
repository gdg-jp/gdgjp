import { createAndRender } from "~/features/assets/create.server";
import type { CompleteOutcome } from "./complete.server";
import { insertJob } from "./job.repository.server";
import type { Job } from "./shared";

type AssetOutput = {
  templateId: string;
  slots: Record<string, unknown>;
  layoutVars: Record<string, unknown>;
  skinSource: string;
  rationaleMd: string;
};

/**
 * `asset` jobs: the slots become an asset, rendered and checked here (the Worker never takes
 * pixels from the agent). A MUST failure queues one more asset job with the failures; that
 * retry's result goes to approval as it is.
 */
export async function importAsset(
  env: Env,
  job: Job,
  output: AssetOutput,
): Promise<CompleteOutcome> {
  const payload = job.payload as {
    templateId?: string;
    forDraftId?: number;
    forScheduleItemId?: number;
    forImageSlotId?: string;
    retryOf?: number;
  };
  if (payload.templateId && payload.templateId !== output.templateId)
    return {
      status: "failed",
      summary: {},
      error: `asked for ${payload.templateId}, got ${output.templateId}`,
    };
  const created = await createAndRender(env, {
    campaignId: job.campaignId,
    templateId: output.templateId,
    slots: output.slots,
    layoutVars: output.layoutVars,
    skinSource: output.skinSource,
    author: "agent",
    jobId: job.id,
    forDraftId: payload.forDraftId ?? null,
    forScheduleItemId: payload.forScheduleItemId ?? null,
    forImageSlotId: payload.forImageSlotId ?? null,
  });
  if (created.mustFails > 0 && !payload.retryOf) {
    await insertJob(env.DB, {
      campaignId: job.campaignId,
      payload: { ...(job.payload as Record<string, unknown>), type: "asset", retryOf: created.id },
      requestedBy: null,
    });
  }
  return {
    status: created.status === "failed" ? "failed" : "succeeded",
    summary: { assetId: created.id, mustFails: created.mustFails },
    error: created.status === "failed" ? "render failed" : undefined,
  };
}
