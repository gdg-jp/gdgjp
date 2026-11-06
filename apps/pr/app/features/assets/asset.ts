import type { CheckResult } from "@skills/pr-playbook/scripts/checks/index.mjs";

export type AssetStatus =
  | "rendering"
  | "needs_approval"
  | "approved"
  | "rejected"
  | "superseded"
  | "failed";

export type Asset = {
  id: number;
  campaignId: number;
  templateId: string;
  slots: Record<string, unknown>;
  layoutVars: Record<string, unknown>;
  skin: Record<string, unknown>;
  width: number;
  height: number;
  scale: number;
  r2Key: string | null;
  r2KeyJpeg: string | null;
  imgId: string | null;
  imgUrl: string | null;
  checks: CheckResult[];
  status: AssetStatus;
  error: string | null;
  forDraftId: number | null;
  forScheduleItemId: number | null;
  forImageSlotId: string | null;
  derivedFromAssetId: number | null;
  jobId: string | null;
  author: "agent" | "human" | "generator";
  approvedBy: string | null;
  createdAt: number;
};

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  rendering: "描画中",
  needs_approval: "承認待ち",
  approved: "承認済み",
  rejected: "却下",
  superseded: "差し替え済み",
  failed: "失敗",
};

/** Where an approved image goes, by template. */
export const ASSET_PURPOSE: Record<string, "connpass" | "ogp" | "post" | "live"> = {
  "connpass-thumbnail": "connpass",
  "ogp-1200x630": "ogp",
  "live-session-16x9": "live",
};
