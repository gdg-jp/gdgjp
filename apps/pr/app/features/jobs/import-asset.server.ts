import { type DesignKit, KIT_TEMPLATE } from "~/features/assets/asset";
import { createAndRender } from "~/features/assets/create.server";
import { constants } from "~/features/playbook/playbook";
import type { CompleteOutcome } from "./complete.server";
import { insertJob } from "./job.repository.server";
import type { Job, JobPayload } from "./shared";

type Direction = { label: string; html: string; rationaleMd: string; kit: DesignKit };

type AssetOutput = {
  mode: "design" | "template";
  templateId: string;
  html: string | null;
  kit: DesignKit | null;
  directions: Direction[] | null;
  slots: Record<string, unknown>;
  layoutVars: Record<string, unknown>;
  skinSource: string;
  rationaleMd: string;
  selfReviewMd: string | null;
};

const MAX_HTML_BYTES = 300_000;

/**
 * `asset` jobs. Design mode: the agent's HTML becomes an asset, sanitized, rendered and checked
 * here (the Worker never takes pixels from the agent); for purpose "kit" each direction becomes
 * one "kit" asset to choose from. Template mode: the slots, as before. A MUST failure queues one
 * more asset job with the failures and the previous version; that retry's result is final.
 */
export async function importAsset(
  env: Env,
  job: Job,
  output: AssetOutput,
): Promise<CompleteOutcome> {
  const payload = job.payload as {
    templateId?: string;
    purpose?: "image" | "kit";
    forDraftId?: number;
    forScheduleItemId?: number;
    forImageSlotId?: string;
    revisionOf?: number;
    retryOf?: number;
  };
  const purpose = payload.purpose === "kit" ? "kit" : "image";
  const expected = purpose === "kit" ? KIT_TEMPLATE : payload.templateId;
  if (expected && expected !== output.templateId)
    return {
      status: "failed",
      summary: {},
      error: `asked for ${expected}, got ${output.templateId}`,
    };

  if (purpose === "kit") {
    const directions = (output.directions ?? []).filter(
      (d) => d.html && d.html.length <= MAX_HTML_BYTES,
    );
    if (!directions.length)
      return { status: "failed", summary: {}, error: "キットの案（directions）が無い" };
    const ids: number[] = [];
    let mustFails = 0;
    for (const d of directions.slice(0, constants.design.directions.max)) {
      const created = await createAndRender(env, {
        campaignId: job.campaignId,
        templateId: KIT_TEMPLATE,
        purpose: "kit",
        html: d.html,
        notes: {
          label: d.label.slice(0, 40),
          rationaleMd: d.rationaleMd,
          selfReviewMd: output.selfReviewMd ?? undefined,
          kit: d.kit,
        },
        skinSource: output.skinSource,
        author: "agent",
        jobId: job.id,
      });
      ids.push(created.id);
      mustFails += created.mustFails;
    }
    return { status: "succeeded", summary: { assetIds: ids, directions: ids.length, mustFails } };
  }

  const design =
    output.mode === "design" && typeof output.html === "string" && output.html.length > 0;
  if (design && (output.html as string).length > MAX_HTML_BYTES)
    return { status: "failed", summary: {}, error: "HTML が大きすぎる（300 KB まで）" };
  const created = await createAndRender(env, {
    campaignId: job.campaignId,
    templateId: output.templateId,
    html: design ? output.html : null,
    notes: design
      ? {
          rationaleMd: output.rationaleMd,
          selfReviewMd: output.selfReviewMd ?? undefined,
          kit: output.kit ?? undefined,
        }
      : { rationaleMd: output.rationaleMd },
    slots: design ? {} : output.slots,
    layoutVars: design ? {} : output.layoutVars,
    skinSource: output.skinSource,
    author: "agent",
    jobId: job.id,
    forDraftId: payload.forDraftId ?? null,
    forScheduleItemId: payload.forScheduleItemId ?? null,
    forImageSlotId: payload.forImageSlotId ?? null,
    derivedFromAssetId: payload.revisionOf ?? null,
  });
  if (created.mustFails > 0 && !payload.retryOf) {
    const base = job.payload as Extract<JobPayload, { type: "asset" }>;
    await insertJob(env.DB, {
      campaignId: job.campaignId,
      payload: {
        ...base,
        retryOf: created.id,
        revisionOf: created.id,
        failures: await failedChecks(env, job.campaignId, created.id),
      },
      requestedBy: null,
    });
  }
  return {
    status: created.status === "failed" ? "failed" : "succeeded",
    summary: { assetId: created.id, mustFails: created.mustFails },
    error: created.status === "failed" ? "render failed" : undefined,
  };
}

async function failedChecks(env: Env, campaignId: number, assetId: number) {
  const { getAsset } = await import("~/features/assets/asset.repository.server");
  const asset = await getAsset(env.DB, campaignId, assetId);
  return (asset?.checks ?? [])
    .filter((c) => c.strength === "MUST" && c.status === "fail")
    .map((c) => ({ ruleId: c.ruleId, detail: c.detail ?? "" }));
}
