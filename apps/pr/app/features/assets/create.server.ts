import { latestBrief } from "~/features/briefs/brief.repository.server";
import { PLAYBOOK_VERSION } from "~/features/playbook/playbook";
import type { Asset, AssetNotes } from "./asset";
import { getAsset, insertAsset, supersedeOthers } from "./asset.repository.server";
import { assetSkin, renderAsset, templateSize } from "./render.server";

export type NewAsset = {
  campaignId: number;
  templateId: string;
  /** Design mode: the agent's (or a person's) HTML. Template mode when absent. */
  html?: string | null;
  purpose?: Asset["purpose"];
  notes?: AssetNotes;
  slots?: Record<string, unknown>;
  layoutVars?: Record<string, unknown>;
  skinSource?: string;
  author: Asset["author"];
  jobId?: string | null;
  forDraftId?: number | null;
  forScheduleItemId?: number | null;
  forImageSlotId?: string | null;
  derivedFromAssetId?: number | null;
};

/** Insert an asset, render and check it; older pending images for the same purpose are superseded. */
export async function createAndRender(env: Env, input: NewAsset) {
  const size = templateSize(input.templateId);
  if (!size) throw new Error(`no image template ${input.templateId}`);
  const brief = (await latestBrief(env.DB, input.campaignId))?.brief ?? null;
  const id = await insertAsset(env.DB, {
    ...input,
    purpose: input.purpose ?? "image",
    html: input.html ?? null,
    notes: input.notes ?? {},
    slots: input.slots ?? {},
    layoutVars: input.layoutVars ?? {},
    skin: {
      ...assetSkin(brief),
      source: input.skinSource ?? (brief?.skin ? "brief" : "gdg-design"),
    },
    width: size.width,
    height: size.height,
    playbookVersion: PLAYBOOK_VERSION,
  });
  const asset = await getAsset(env.DB, input.campaignId, id);
  if (!asset) throw new Error("asset vanished");
  const result = await renderAsset(env, asset, brief);
  await supersedeOthers(env.DB, asset);
  return { id, ...result };
}
