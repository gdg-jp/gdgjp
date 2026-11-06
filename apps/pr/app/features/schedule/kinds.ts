/**
 * `schedule_items.kind`. The source is docs/plans/pr/00-overview.md §4 (kinds.test.ts keeps
 * them equal). Not a SQL CHECK because the set grows.
 */
export const SCHEDULE_KINDS = [
  "x_post",
  "x_ad_start",
  "ig_post",
  "ig_ad_start",
  "short_video",
  "connpass_publish",
  "connpass_update",
  "connpass_subevent",
  "connpass_mail",
  "luma_publish",
  "techplay_publish",
  "findy_submit",
  "bevy_publish",
  "line_post",
  "discord_post",
  "press_release",
  "website_update",
  "flyer_text",
  "flyer_print",
  "flyer_distribute",
  "print_item",
  "lt_at_event",
  "community_ask",
  "org_outreach",
  "sponsor_ask",
  "interview",
  "staff_reminder",
  "speaker_request",
  "live_post",
  "metrics_review",
] as const;

export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export function isScheduleKind(value: unknown): value is ScheduleKind {
  return typeof value === "string" && (SCHEDULE_KINDS as readonly string[]).includes(value);
}

export const KIND_LABELS: Record<ScheduleKind, string> = {
  x_post: "X 投稿",
  x_ad_start: "X 広告の開始",
  ig_post: "Instagram 投稿",
  ig_ad_start: "Instagram 広告の開始",
  short_video: "ショート動画",
  connpass_publish: "connpass 公開",
  connpass_update: "connpass 更新",
  connpass_subevent: "connpass サブイベント",
  connpass_mail: "connpass メール",
  luma_publish: "Luma 掲載",
  techplay_publish: "TECH PLAY 掲載",
  findy_submit: "Findy Conference 申請",
  bevy_publish: "Bevy 登録",
  line_post: "LINE 投稿",
  discord_post: "Discord 告知",
  press_release: "プレスリリース",
  website_update: "Web サイト更新",
  flyer_text: "フライヤー文言",
  flyer_print: "フライヤー印刷",
  flyer_distribute: "フライヤー配布",
  print_item: "印刷物",
  lt_at_event: "他イベントで LT",
  community_ask: "コミュニティへの依頼",
  org_outreach: "学校・企業への営業",
  sponsor_ask: "スポンサーへの依頼",
  interview: "未申込者への聞き取り",
  staff_reminder: "スタッフへの依頼",
  speaker_request: "登壇者への依頼",
  live_post: "当日実況",
  metrics_review: "数値の確認",
};

/** Kinds that are requests to a person or organization (tracked as sent / replied / declined). */
export const REQUEST_KINDS: readonly ScheduleKind[] = [
  "community_ask",
  "org_outreach",
  "sponsor_ask",
];

/** Kinds whose drafts a runner job writes. */
export const DRAFTABLE_KINDS: readonly ScheduleKind[] = [
  "x_post",
  "ig_post",
  "live_post",
  "connpass_mail",
  "flyer_text",
];

export const ITEM_STATUSES = [
  "planned",
  "drafting",
  "in_review",
  "needs_approval",
  "approved",
  "dispatching",
  "scheduled",
  "done",
  "failed",
  "skipped",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const STATUS_LABELS: Record<ItemStatus, string> = {
  planned: "予定",
  drafting: "作成中",
  in_review: "レビュー待ち",
  needs_approval: "承認待ち",
  approved: "承認済み",
  dispatching: "配信中",
  scheduled: "予約済み",
  done: "完了",
  failed: "失敗",
  skipped: "見送り",
};
