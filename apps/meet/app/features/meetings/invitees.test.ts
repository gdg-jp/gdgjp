import type { MeetDirectoryMember } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import {
  MAX_COHOSTS,
  MAX_INVITEES,
  isGoogleGroupEmail,
  parseEmailInputList,
  resolveInvitees,
} from "./invitees";

const HOST_EMAIL = "community-support@gdgoc.jp";

function member(
  overrides: Partial<MeetDirectoryMember> & {
    userId: string;
    email: string;
    chapterId: number;
    role: "organizer" | "member";
  },
): MeetDirectoryMember {
  return {
    name: overrides.name ?? overrides.userId,
    chapterSlug: overrides.chapterSlug ?? `chapter-${overrides.chapterId}`,
    chapterName: overrides.chapterName ?? `Chapter ${overrides.chapterId}`,
    ...overrides,
  };
}

describe("resolveInvitees", () => {
  it("作成者は主催チャプター内のロールが member でも常に cohost になる", () => {
    const result = resolveInvitees({
      creator: { userId: "u-member", email: "member@example.com", name: "Member Creator" },
      hostChapterId: 1,
      sources: [
        { kind: "host_chapter_organizers", chapterId: 1, email: null, role: "cohost" },
        { kind: "chapter_all", chapterId: 1, email: null, role: "participant" },
      ],
      chapterMembers: [
        member({ userId: "u-org", email: "org@example.com", chapterId: 1, role: "organizer" }),
        member({
          userId: "u-member",
          email: "member@example.com",
          name: "Member Creator",
          chapterId: 1,
          role: "member",
        }),
      ],
      hostEmail: HOST_EMAIL,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const creator = result.invitees.find((i) => i.emailNormalized === "member@example.com");
    expect(creator).toMatchObject({
      role: "cohost",
      userId: "u-member",
      displayName: "Member Creator",
    });
    expect(creator?.sourceKinds).toContain("creator");
    expect(creator?.sourceKinds).toContain("chapter_all");
  });

  it("主催チャプター Organizer をオプトアウトした場合は他の Organizer が入らず作成者のみ cohost として残る", () => {
    const result = resolveInvitees({
      creator: { userId: "u-1", email: "creator@example.com", name: "Creator" },
      hostChapterId: 1,
      sources: [],
      chapterMembers: [
        member({ userId: "u-1", email: "creator@example.com", chapterId: 1, role: "organizer" }),
        member({ userId: "u-2", email: "other-org@example.com", chapterId: 1, role: "organizer" }),
      ],
      hostEmail: HOST_EMAIL,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invitees).toHaveLength(1);
    expect(result.invitees[0]).toMatchObject({
      emailNormalized: "creator@example.com",
      role: "cohost",
      sourceKinds: ["creator"],
    });
    expect(result.counts).toMatchObject({
      creatorCount: 1,
      hostChapterCount: 0,
      totalCount: 1,
      cohostCount: 1,
      participantCount: 0,
    });
  });

  it("複数招待元に同一人物が含まれても 1 件に統合し、cohost を優先する", () => {
    const result = resolveInvitees({
      creator: { userId: "u-creator", email: "creator@example.com", name: "Creator" },
      hostChapterId: 1,
      sources: [
        { kind: "chapter_all", chapterId: 2, email: null, role: "participant" },
        { kind: "email", chapterId: null, email: "dual@example.com", role: "cohost" },
      ],
      chapterMembers: [
        member({
          userId: "u-dual",
          email: "dual@example.com",
          name: "Dual Person",
          chapterId: 2,
          role: "member",
        }),
      ],
      hostEmail: HOST_EMAIL,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invitees).toHaveLength(2);
    const dual = result.invitees.find((i) => i.emailNormalized === "dual@example.com");
    expect(dual).toMatchObject({
      email: "dual@example.com",
      displayName: "Dual Person",
      userId: "u-dual",
      role: "cohost",
      sourceKinds: ["chapter_all", "email"],
    });
  });

  it("Gmail のドット違い（a.b@gmail.com と ab@gmail.com）を同一人物として統合する", () => {
    const result = resolveInvitees({
      creator: { userId: "u-creator", email: "creator@example.com", name: "Creator" },
      hostChapterId: 1,
      sources: [
        { kind: "chapter_organizers", chapterId: 2, email: null, role: "participant" },
        { kind: "email", chapterId: null, email: "ab@gmail.com", role: "cohost" },
      ],
      chapterMembers: [
        member({
          userId: "u-gmail",
          email: "A.B@gmail.com",
          name: "Gmail User",
          chapterId: 2,
          role: "organizer",
        }),
      ],
      hostEmail: HOST_EMAIL,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invitees).toHaveLength(2);
    const merged = result.invitees.find((i) => i.emailNormalized === "ab@gmail.com");
    expect(merged).toMatchObject({
      displayName: "Gmail User",
      userId: "u-gmail",
      role: "cohost",
      sourceKinds: ["chapter_organizers", "email"],
    });
  });

  it("共有ホストアカウント（GOOGLE_HOST_EMAIL）を招待者から除外する", () => {
    const result = resolveInvitees({
      creator: { userId: "u-creator", email: "creator@example.com", name: "Creator" },
      hostChapterId: 1,
      sources: [
        { kind: "host_chapter_organizers", chapterId: 1, email: null, role: "cohost" },
        {
          kind: "email",
          chapterId: null,
          email: "COMMUNITY-SUPPORT@gdgoc.jp",
          role: "participant",
        },
      ],
      chapterMembers: [
        member({
          userId: "u-host",
          email: "community-support@gdgoc.jp",
          chapterId: 1,
          role: "organizer",
        }),
      ],
      hostEmail: HOST_EMAIL,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invitees.map((i) => i.emailNormalized)).toEqual(["creator@example.com"]);
  });

  it("@googlegroups.com の個別メールを拒否する", () => {
    const result = resolveInvitees({
      creator: { userId: "u-creator", email: "creator@example.com", name: "Creator" },
      hostChapterId: 1,
      sources: [{ kind: "email", chapterId: null, email: "team@googlegroups.com", role: "cohost" }],
      chapterMembers: [],
      hostEmail: HOST_EMAIL,
    });

    expect(result).toEqual({
      ok: false,
      code: "google_group_not_allowed",
      emails: ["team@googlegroups.com"],
    });
  });

  it("招待者が MAX_INVITEES（150）を超えた場合は too_many_invitees を返す", () => {
    const sources = Array.from({ length: MAX_INVITEES }, (_, idx) => ({
      kind: "email" as const,
      chapterId: null,
      email: `guest-${idx}@example.com`,
      role: "participant" as const,
    }));
    const result = resolveInvitees({
      creator: { userId: "u-creator", email: "creator@example.com", name: "Creator" },
      hostChapterId: 1,
      sources,
      chapterMembers: [],
      hostEmail: HOST_EMAIL,
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.code !== "too_many_invitees") return;
    expect(result.count).toBe(MAX_INVITEES + 1);
    expect(result.max).toBe(MAX_INVITEES);
    expect(result.counts.exceedsMaxInvitees).toBe(true);
  });

  it("共同主催者が MAX_COHOSTS（25）を超えた場合は too_many_cohosts を返す", () => {
    const sources = Array.from({ length: MAX_COHOSTS }, (_, idx) => ({
      kind: "email" as const,
      chapterId: null,
      email: `cohost-${idx}@example.com`,
      role: "cohost" as const,
    }));
    const result = resolveInvitees({
      creator: { userId: "u-creator", email: "creator@example.com", name: "Creator" },
      hostChapterId: 1,
      sources,
      chapterMembers: [],
      hostEmail: HOST_EMAIL,
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.code !== "too_many_cohosts") return;
    expect(result.count).toBe(MAX_COHOSTS + 1);
    expect(result.max).toBe(MAX_COHOSTS);
    expect(result.counts.exceedsMaxCohosts).toBe(true);
  });
});

describe("isGoogleGroupEmail / parseEmailInputList", () => {
  it("Google グループ・不正メール・有効メールを正しく分類する", () => {
    expect(isGoogleGroupEmail("gdg-organizers@googlegroups.com")).toBe(true);
    expect(isGoogleGroupEmail("alice@example.com")).toBe(false);

    const parsed = parseEmailInputList(
      "alice@example.com, bad-email\nbob@example.com; group@googlegroups.com",
    );
    expect(parsed).toEqual({
      emails: ["alice@example.com", "bob@example.com"],
      invalidEmails: ["bad-email"],
      googleGroupEmails: ["group@googlegroups.com"],
    });
  });
});
