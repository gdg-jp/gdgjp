import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import { campaignPermissions } from "./access.server";
import type { Campaign, CampaignChapter, CampaignMember } from "./campaign";

const user = (id = "u1", isAdmin = false): AuthUser => ({
  id,
  email: `${id}@x`,
  name: id,
  image: null,
  isAdmin,
});
const chapter = (chapterId: number, role: UserChapter["role"] = "member"): UserChapter => ({
  chapterId,
  chapterSlug: `c${chapterId}`,
  role,
});
const campaign = { id: 1, chapterId: 1 } as Campaign;
const chapters: CampaignChapter[] = [
  { chapterId: 1, chapterSlug: "c1", role: "host" },
  { chapterId: 2, chapterSlug: "c2", role: "co-host" },
];
const lead: CampaignMember[] = [
  { userId: "lead", name: "", email: "", roles: ["lead"], discordHandle: null },
];

describe("campaignPermissions", () => {
  it("hides the campaign from chapters that neither host nor co-host it", () => {
    expect(campaignPermissions(user(), [chapter(3)], campaign, chapters, [])).toBeNull();
  });
  it("lets co-host members see and edit, but not manage", () => {
    expect(campaignPermissions(user(), [chapter(2, "organizer")], campaign, chapters, [])).toEqual({
      manage: false,
      edit: true,
    });
  });
  it("lets the host organizer and the lead manage", () => {
    expect(
      campaignPermissions(user(), [chapter(1, "organizer")], campaign, chapters, [])?.manage,
    ).toBe(true);
    expect(campaignPermissions(user("lead"), [chapter(2)], campaign, chapters, lead)?.manage).toBe(
      true,
    );
    expect(campaignPermissions(user(), [chapter(1)], campaign, chapters, [])?.manage).toBe(false);
  });
  it("lets super admins in everywhere", () => {
    expect(campaignPermissions(user("a", true), [], campaign, chapters, [])?.manage).toBe(true);
  });
});
