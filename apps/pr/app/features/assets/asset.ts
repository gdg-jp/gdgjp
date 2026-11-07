import type { CheckResult } from "@skills/pr-playbook/scripts/checks/index.mjs";

export type AssetStatus =
  | "rendering"
  | "needs_approval"
  | "approved"
  | "rejected"
  | "superseded"
  | "failed";

/** "image" is a usable image; "kit" is one direction for the event's face (its design kit). */
export type AssetPurpose = "image" | "kit";

/** The agent's design kit: the decisions every image of the event shares. */
export type DesignKit = {
  feel: string;
  why: string;
  palette: {
    dominant: string;
    ground: string;
    panel: string;
    ink: string;
    keyline: string;
    emphasis: string;
    extra: string[];
  };
  fonts: { heading: string; headingJa: string; body: string };
  lockup: {
    kind: "braces" | "logo-image" | "official" | "text";
    text: string;
    sub: string;
    notes: string;
  };
  motifs: string[];
  photo: { shape: string; keyline: string; notes: string };
  facts: { dateStyle: string; venueStyle: string; badges: string[] };
};

export type AssetNotes = {
  label?: string;
  rationaleMd?: string;
  selfReviewMd?: string;
  kit?: DesignKit;
  sanitizer?: string[];
};

export type Asset = {
  id: number;
  campaignId: number;
  templateId: string;
  purpose: AssetPurpose;
  /** Design mode: the agent's HTML (as written; the Worker sanitizes it before rendering). */
  html: string | null;
  notes: AssetNotes;
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

/** What each template is for, in people's words (the order is the order of the picker). */
export const TEMPLATE_LABELS: Record<string, string> = {
  "connpass-thumbnail": "connpass のサムネイル（顔）",
  "session-card-16x9": "セッション紹介（横）",
  "speaker-card-1x1": "登壇者紹介（正方形）",
  "session-card-1x1": "セッション紹介（正方形）",
  "x-post-16x9": "X の投稿画像（横）: カウントダウン、登壇決定、お知らせ",
  "x-post-1x1": "X の投稿画像（正方形）",
  "x-ad-16x9": "X の広告",
  "ig-feed-4x5": "Instagram のフィード",
  "ig-story-9x16": "Instagram のストーリー・広告",
  "ogp-1200x630": "短縮リンクの OGP",
  "photo-16x9": "写真を下地にした投稿",
  "live-session-16x9": "当日実況のカード",
};

/** The library's kinds, and which templates each kind is a reference for. */
export const REFERENCE_KINDS = [
  "thumbnail",
  "session",
  "speaker",
  "post",
  "ad",
  "ig",
  "print",
  "other",
] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
export const REFERENCE_KIND_LABELS: Record<ReferenceKind, string> = {
  thumbnail: "サムネイル・顔",
  session: "セッション紹介",
  speaker: "登壇者紹介",
  post: "投稿画像（カウントダウン、告知）",
  ad: "広告",
  ig: "Instagram",
  print: "印刷物",
  other: "その他",
};

export function referenceKindFor(templateId: string): ReferenceKind {
  if (templateId === "connpass-thumbnail" || templateId === "ogp-1200x630") return "thumbnail";
  if (templateId.startsWith("session-card")) return "session";
  if (templateId.startsWith("speaker-card")) return "speaker";
  if (templateId.startsWith("x-ad")) return "ad";
  if (templateId.startsWith("ig-")) return "ig";
  return "post";
}

export const KIT_TEMPLATE = "connpass-thumbnail";

export function parseNotes(raw: string | null | undefined): AssetNotes {
  try {
    const value = JSON.parse(raw ?? "{}");
    return value && typeof value === "object" ? (value as AssetNotes) : {};
  } catch {
    return {};
  }
}
