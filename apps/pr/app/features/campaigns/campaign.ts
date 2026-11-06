export type CampaignStatus = "draft" | "active" | "closed";

export type Campaign = {
  id: number;
  chapterId: number;
  chapterSlug: string;
  parentCampaignId: number | null;
  slug: string;
  name: string;
  eventAt: number | null;
  venue: string | null;
  status: CampaignStatus;
  connpassGroupSlug: string | null;
  connpassEventId: string | null;
  tinyurlCampaignId: number | null;
  budgetTotalYen: number;
  /** Send derived staff reminders to Discord without a person pressing send. */
  autoStaffReminders: boolean;
  playbookVersion: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type CampaignChapter = { chapterId: number; chapterSlug: string; role: "host" | "co-host" };

export const MEMBER_ROLES = [
  "lead",
  "sub",
  "reviewer",
  "connpass",
  "writer",
  "designer",
  "video",
  "outreach",
  "photographer",
] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  lead: "リード",
  sub: "サブリード",
  reviewer: "レビュアー",
  connpass: "connpass 担当",
  writer: "文章",
  designer: "デザイン",
  video: "動画",
  outreach: "営業・依頼",
  photographer: "撮影",
};

export type CampaignMember = {
  userId: string;
  name: string;
  email: string;
  roles: MemberRole[];
  discordHandle: string | null;
};

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "準備中",
  active: "告知中",
  closed: "終了",
};

export function parseRoles(raw: string | null | undefined): MemberRole[] {
  try {
    const value = JSON.parse(raw ?? "[]");
    return Array.isArray(value)
      ? value.filter((r): r is MemberRole => MEMBER_ROLES.includes(r))
      : [];
  } catch {
    return [];
  }
}
