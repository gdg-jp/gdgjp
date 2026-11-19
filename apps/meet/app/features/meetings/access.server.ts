import type { AuthUser } from "@gdgjp/gdg-lib";
import { requireUser } from "~/features/auth/access.server";
import { normalizeEmail } from "~/features/google/email";
import type { MeetingInviteeRecord, MeetingRecord, PublicInvitee } from "./meeting";
import { getMeetingById, listMeetingInvitees } from "./meetings.repository.server";

export type MeetingViewAccess = {
  user: AuthUser;
  meeting: MeetingRecord;
  invitees: MeetingInviteeRecord[];
  canSeeManualEmails: boolean;
};

/** 会議詳細の閲覧権限を判定する（管理者・作成者・正規化メール一致の招待者）。 */
export function canViewMeeting(
  user: Pick<AuthUser, "id" | "email" | "isAdmin">,
  meeting: Pick<MeetingRecord, "createdByUserId">,
  invitees: readonly Pick<MeetingInviteeRecord, "emailNormalized">[],
): boolean {
  if (user.isAdmin) return true;
  if (meeting.createdByUserId === user.id) return true;
  const normalized = normalizeEmail(user.email);
  return invitees.some((inv) => inv.emailNormalized === normalized);
}

/** 個人メール追加分（`sourceKinds` に `"email"` を含む）のメールアドレスを表示してよいか判定する。 */
export function canViewManualInviteeEmails(
  user: Pick<AuthUser, "id" | "email" | "isAdmin">,
  meeting: Pick<MeetingRecord, "createdByUserId">,
  invitees: readonly Pick<MeetingInviteeRecord, "emailNormalized" | "role">[],
): boolean {
  if (user.isAdmin) return true;
  if (meeting.createdByUserId === user.id) return true;
  const normalized = normalizeEmail(user.email);
  return invitees.some((inv) => inv.emailNormalized === normalized && inv.role === "cohost");
}

/**
 * 招待者一覧をブラウザへ返却可能な形式へ変換する。
 * - `"email"` を含まないチャプター由来の招待者は、管理者・作成者であっても `email` を一切含めない
 * - `"email"` を含む招待者でも、閲覧者が作成者・co-host・管理者以外の場合は `email` を含めない
 */
export function toPublicInviteeList(
  invitees: readonly MeetingInviteeRecord[],
  options: { canSeeManualEmails: boolean },
): PublicInvitee[] {
  return invitees.map((invitee) => {
    const isCreator = invitee.sourceKinds.includes("creator");
    const isManualEmail = invitee.sourceKinds.includes("email");
    const isChapterDerived = invitee.sourceKinds.some(
      (kind) =>
        kind === "host_chapter_organizers" ||
        kind === "chapter_organizers" ||
        kind === "chapter_all",
    );

    const base: PublicInvitee = {
      displayName: invitee.displayName,
      role: invitee.role,
      isCreator,
      isChapterDerived,
    };

    if (options.canSeeManualEmails && isManualEmail) {
      return { ...base, email: invitee.email };
    }
    return base;
  });
}

type AccessDeps = {
  requireUserFn?: (env: Env, request: Request) => Promise<AuthUser>;
};

/**
 * 会議詳細ページのアクセス検証を行う。
 * - サインインは必須だがチャプター所属は不要
 * - 会議が存在しない、または閲覧権限がない場合は存在を秘匿するため 404 を返す
 */
export async function requireMeetingViewAccess(
  env: Env,
  request: Request,
  meetingId: string,
  deps: AccessDeps = {},
): Promise<MeetingViewAccess> {
  const requireUserFn = deps.requireUserFn ?? requireUser;
  const user = await requireUserFn(env, request);

  const meeting = await getMeetingById(env.DB, meetingId);
  if (!meeting) {
    throw new Response("Not Found", { status: 404 });
  }

  const invitees = await listMeetingInvitees(env.DB, meetingId);
  if (!canViewMeeting(user, meeting, invitees)) {
    throw new Response("Not Found", { status: 404 });
  }

  return {
    user,
    meeting,
    invitees,
    canSeeManualEmails: canViewManualInviteeEmails(user, meeting, invitees),
  };
}
