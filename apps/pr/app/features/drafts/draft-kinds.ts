/** `drafts.kind`. The checkable ones match skills/pr-playbook's DRAFT_KINDS. */
export const DRAFT_KINDS = [
  "copy",
  "x_post",
  "ig_post",
  "connpass_page",
  "connpass_mail",
  "asset_spec",
  "plan",
] as const;
export const EXTRA_DRAFT_KINDS = [
  "dm_request",
  "reminder",
  "flyer_text",
  "listing",
  "report",
] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number] | (typeof EXTRA_DRAFT_KINDS)[number];

export const DRAFT_KIND_LABELS: Record<DraftKind, string> = {
  copy: "コピー",
  x_post: "X 投稿",
  ig_post: "Instagram 投稿",
  connpass_page: "connpass ページ",
  connpass_mail: "connpass メール",
  asset_spec: "画像",
  plan: "計画",
  dm_request: "依頼文",
  reminder: "リマインド",
  flyer_text: "フライヤー文言",
  listing: "媒体掲載",
  report: "レポート",
};
