import type { MeetDirectoryMember } from "@gdgjp/gdg-lib";
import { isValidEmail, normalizeEmail } from "~/features/google/email";
import type {
  InviteSourceKind,
  InviteePreviewCounts,
  InviteeRole,
  InviteeSourceKind,
} from "./meeting";

/** Business Standard の Meet 参加者上限（docs/plans/meet/00a-poc-findings.md §6）。 */
export const MAX_INVITEES = 150;

/** Meet の共同主催者（co-host）上限（docs/plans/meet/00a-poc-findings.md §6）。 */
export const MAX_COHOSTS = 25;

const GOOGLE_GROUPS_DOMAIN = "googlegroups.com";

export type InviteSourceInput = {
  kind: InviteSourceKind;
  chapterId: number | null;
  email: string | null;
  role: InviteeRole;
};

export type ResolveInviteesInput = {
  creator: { userId: string; email: string; name: string };
  hostChapterId: number;
  sources: readonly InviteSourceInput[];
  chapterMembers: readonly MeetDirectoryMember[];
  hostEmail: string;
};

export type ResolvedInvitee = {
  emailNormalized: string;
  email: string;
  displayName: string | null;
  userId: string | null;
  role: InviteeRole;
  sourceKinds: InviteeSourceKind[];
};

export type ResolveInviteesResult =
  | {
      ok: true;
      invitees: ResolvedInvitee[];
      counts: InviteePreviewCounts;
    }
  | {
      ok: false;
      code: "too_many_invitees" | "too_many_cohosts";
      count: number;
      max: number;
      counts: InviteePreviewCounts;
    }
  | {
      ok: false;
      code: "google_group_not_allowed";
      emails: string[];
    }
  | {
      ok: false;
      code: "invalid_email";
      emails: string[];
    };

/** メールアドレスが Google グループ（`@googlegroups.com`）かどうかを判定する。 */
export function isGoogleGroupEmail(raw: string): boolean {
  const trimmed = raw.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0) return false;
  return trimmed.slice(atIndex + 1) === GOOGLE_GROUPS_DOMAIN;
}

/**
 * 改行・カンマ・セミコロン・空白区切りの個別メール入力をパースし、
 * 有効メール・形式不正・Google グループへ分類する。
 */
export function parseEmailInputList(raw: string): {
  emails: string[];
  invalidEmails: string[];
  googleGroupEmails: string[];
} {
  const tokens = raw
    .split(/[\s,;、]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const emails: string[] = [];
  const invalidEmails: string[] = [];
  const googleGroupEmails: string[] = [];

  for (const token of tokens) {
    if (!isValidEmail(token)) {
      invalidEmails.push(token);
      continue;
    }
    if (isGoogleGroupEmail(token)) {
      googleGroupEmails.push(token);
      continue;
    }
    emails.push(token);
  }

  return { emails, invalidEmails, googleGroupEmails };
}

type CandidateEntry = {
  email: string;
  displayName: string | null;
  userId: string | null;
  role: InviteeRole;
  sourceKind: InviteeSourceKind;
};

/**
 * 招待元（主催チャプター・他チャプター・個別メール）と作成者から最終招待者一覧を解決する純粋関数。
 * - 作成者は常に `cohost` として含める
 * - 共有ホストアカウント（`hostEmail`）は常に除外する
 * - `normalizeEmail` をキーに重複排除し、`cohost` を `participant` より優先する
 * - Google グループ（`@googlegroups.com`）および不正メールを拒否する
 * - 解決後の人数が `MAX_INVITEES` / `MAX_COHOSTS` を超えた場合はエラーを返す
 */
export function resolveInvitees(input: ResolveInviteesInput): ResolveInviteesResult {
  const invalidEmails: string[] = [];
  const googleGroupEmails: string[] = [];

  for (const source of input.sources) {
    if (source.kind !== "email") continue;
    const raw = (source.email ?? "").trim();
    if (!isValidEmail(raw)) {
      invalidEmails.push(raw || "(空)");
      continue;
    }
    if (isGoogleGroupEmail(raw)) {
      googleGroupEmails.push(raw);
    }
  }

  if (googleGroupEmails.length > 0) {
    return { ok: false, code: "google_group_not_allowed", emails: googleGroupEmails };
  }
  if (invalidEmails.length > 0) {
    return { ok: false, code: "invalid_email", emails: invalidEmails };
  }

  const normalizedHostEmail = normalizeEmail(input.hostEmail);
  const candidates: CandidateEntry[] = [];

  for (const source of input.sources) {
    if (source.kind === "host_chapter_organizers") {
      for (const member of input.chapterMembers) {
        if (member.chapterId === input.hostChapterId && member.role === "organizer") {
          candidates.push({
            email: member.email,
            displayName: member.name,
            userId: member.userId,
            role: source.role,
            sourceKind: "host_chapter_organizers",
          });
        }
      }
      continue;
    }

    if (source.kind === "chapter_organizers") {
      for (const member of input.chapterMembers) {
        if (member.chapterId === source.chapterId && member.role === "organizer") {
          candidates.push({
            email: member.email,
            displayName: member.name,
            userId: member.userId,
            role: source.role,
            sourceKind: "chapter_organizers",
          });
        }
      }
      continue;
    }

    if (source.kind === "chapter_all") {
      for (const member of input.chapterMembers) {
        if (member.chapterId === source.chapterId) {
          candidates.push({
            email: member.email,
            displayName: member.name,
            userId: member.userId,
            role: source.role,
            sourceKind: "chapter_all",
          });
        }
      }
      continue;
    }

    if (source.kind === "email" && source.email) {
      candidates.push({
        email: source.email.trim(),
        displayName: null,
        userId: null,
        role: source.role,
        sourceKind: "email",
      });
    }
  }

  // 作成者は常に cohost として登録する。
  candidates.push({
    email: input.creator.email.trim(),
    displayName: input.creator.name,
    userId: input.creator.userId,
    role: "cohost",
    sourceKind: "creator",
  });

  const merged = new Map<string, ResolvedInvitee>();
  const creatorSet = new Set<string>();
  const hostChapterSet = new Set<string>();
  const otherChaptersSet = new Set<string>();
  const emailSourceSet = new Set<string>();

  for (const entry of candidates) {
    const emailNormalized = normalizeEmail(entry.email);
    if (!emailNormalized || emailNormalized === normalizedHostEmail) {
      continue;
    }

    if (entry.sourceKind === "creator") creatorSet.add(emailNormalized);
    else if (entry.sourceKind === "host_chapter_organizers") hostChapterSet.add(emailNormalized);
    else if (entry.sourceKind === "chapter_organizers" || entry.sourceKind === "chapter_all") {
      otherChaptersSet.add(emailNormalized);
    } else if (entry.sourceKind === "email") {
      emailSourceSet.add(emailNormalized);
    }

    const existing = merged.get(emailNormalized);
    if (!existing) {
      merged.set(emailNormalized, {
        emailNormalized,
        email: entry.email,
        displayName: entry.displayName,
        userId: entry.userId,
        role: entry.role,
        sourceKinds: [entry.sourceKind],
      });
      continue;
    }

    const role: InviteeRole =
      existing.role === "cohost" || entry.role === "cohost" ? "cohost" : "participant";
    const sourceKinds = existing.sourceKinds.includes(entry.sourceKind)
      ? existing.sourceKinds
      : [...existing.sourceKinds, entry.sourceKind];
    const preferIncomingProfile = existing.userId === null && entry.userId !== null;

    merged.set(emailNormalized, {
      emailNormalized,
      email: preferIncomingProfile ? entry.email : existing.email,
      displayName: existing.displayName ?? entry.displayName,
      userId: existing.userId ?? entry.userId,
      role,
      sourceKinds,
    });
  }

  const invitees = [...merged.values()].sort((a, b) => {
    const aCreator = a.sourceKinds.includes("creator") ? 0 : 1;
    const bCreator = b.sourceKinds.includes("creator") ? 0 : 1;
    if (aCreator !== bCreator) return aCreator - bCreator;
    const aRole = a.role === "cohost" ? 0 : 1;
    const bRole = b.role === "cohost" ? 0 : 1;
    if (aRole !== bRole) return aRole - bRole;
    return (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email, "ja");
  });

  const totalCount = invitees.length;
  const cohostCount = invitees.filter((inv) => inv.role === "cohost").length;
  const counts: InviteePreviewCounts = {
    creatorCount: creatorSet.size,
    hostChapterCount: hostChapterSet.size,
    otherChaptersCount: otherChaptersSet.size,
    emailCount: emailSourceSet.size,
    totalCount,
    cohostCount,
    participantCount: totalCount - cohostCount,
    exceedsMaxInvitees: totalCount > MAX_INVITEES,
    exceedsMaxCohosts: cohostCount > MAX_COHOSTS,
  };

  if (totalCount > MAX_INVITEES) {
    return {
      ok: false,
      code: "too_many_invitees",
      count: totalCount,
      max: MAX_INVITEES,
      counts,
    };
  }
  if (cohostCount > MAX_COHOSTS) {
    return {
      ok: false,
      code: "too_many_cohosts",
      count: cohostCount,
      max: MAX_COHOSTS,
      counts,
    };
  }

  return { ok: true, invitees, counts };
}
