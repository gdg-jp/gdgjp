import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { requireUserWithChapter } from "~/features/auth/access.server";
import type { Campaign, CampaignChapter, CampaignMember } from "./campaign";
import { getCampaignBySlug, listCampaignChapters, listMembers } from "./campaign.repository.server";
import { normalizeSlug } from "./slug";

export type CampaignPermissions = {
  /** Lead or the host chapter's organizer: brief, settings, co-hosts, members. */
  manage: boolean;
  /** Any member of a host / co-host chapter: schedule, drafts, reviews. */
  edit: boolean;
};

export type CampaignAccess = {
  user: AuthUser;
  chapters: UserChapter[];
  campaign: Campaign;
  campaignChapters: CampaignChapter[];
  members: CampaignMember[];
  permissions: CampaignPermissions;
};

/** Pure: who may do what in a campaign. Super admins may do everything. */
export function campaignPermissions(
  user: AuthUser,
  chapters: UserChapter[],
  campaign: Campaign,
  campaignChapters: CampaignChapter[],
  members: CampaignMember[],
): CampaignPermissions | null {
  const ids = new Set(campaignChapters.map((c) => c.chapterId));
  ids.add(campaign.chapterId);
  const inChapter = chapters.some((c) => ids.has(c.chapterId));
  if (!inChapter && !user.isAdmin) return null;
  const hostOrganizer = chapters.some(
    (c) => c.chapterId === campaign.chapterId && c.role === "organizer",
  );
  const lead = members.some((m) => m.userId === user.id && m.roles.includes("lead"));
  return { manage: user.isAdmin || hostOrganizer || lead, edit: true };
}

/** Gate every /c/:slug page: signed in, in a host or co-host chapter. 404 otherwise. */
export async function requireCampaignAccess(
  env: Env,
  request: Request,
  rawSlug: string | undefined,
  need: keyof CampaignPermissions = "edit",
): Promise<CampaignAccess> {
  const slug = normalizeSlug(rawSlug);
  if (!slug) throw new Response(null, { status: 404 });
  const { user, chapters } = await requireUserWithChapter(env, request);
  const campaign = await getCampaignBySlug(env.DB, slug);
  if (!campaign) throw new Response(null, { status: 404 });
  const [campaignChapters, members] = await Promise.all([
    listCampaignChapters(env.DB, campaign.id),
    listMembers(env.DB, campaign.id),
  ]);
  const permissions = campaignPermissions(user, chapters, campaign, campaignChapters, members);
  if (!permissions) throw new Response(null, { status: 404 });
  if (!permissions[need]) throw new Response("Forbidden", { status: 403 });
  return { user, chapters, campaign, campaignChapters, members, permissions };
}
