import type { AuthUser } from "@gdgjp/gdg-lib";
import { requireUser } from "~/features/auth/access.server";
import { normalizeEmail } from "~/features/google/email";
import type { MeetingInviteeRecord, MeetingRecord, PublicInvitee } from "./meeting";
import { getMeetingById, listMeetingInvitees } from "./meetings.repository.server";

export type MeetingViewAccess = {
  user: AuthUser;
  meeting: MeetingRecord;
  invitees: MeetingInviteeRecord[];
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

/**
 * 招待者一覧をブラウザへ返却する形式へ変換する。
 * 会議の閲覧権限がある全員に対し、チャプター由来を含むすべての招待者の名前とメールアドレスを返す。
 */
export function toPublicInviteeList(invitees: readonly MeetingInviteeRecord[]): PublicInvitee[] {
  return invitees.map((invitee) => {
    const isCreator = invitee.sourceKinds.includes("creator");
    const isChapterDerived = invitee.sourceKinds.some(
      (kind) =>
        kind === "host_chapter_organizers" ||
        kind === "chapter_organizers" ||
        kind === "chapter_all",
    );

    return {
      displayName: invitee.displayName,
      email: invitee.email,
      role: invitee.role,
      isCreator,
      isChapterDerived,
    };
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
  };
}
