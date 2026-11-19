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

/** 会議の編集・再同期・取り消しを行える役割（管理者または正規化メール一致の `cohost`）か判定する。 */
export function hasMeetingEditRole(
  user: Pick<AuthUser, "email" | "isAdmin">,
  invitees: readonly Pick<MeetingInviteeRecord, "emailNormalized" | "role">[],
): boolean {
  if (user.isAdmin) return true;
  const normalized = normalizeEmail(user.email);
  return invitees.some((inv) => inv.emailNormalized === normalized && inv.role === "cohost");
}

/**
 * 会議の編集・再同期・取り消し権限を判定する。
 * - `meeting.status === "active"` であること（`canceled` / `failed` / `creating` は不可）
 * - チャプター所属は問わず、GDG Accounts 管理者または正規化メール一致の `cohost` であれば許可
 */
export function canEditMeeting(
  user: Pick<AuthUser, "email" | "isAdmin">,
  meeting: Pick<MeetingRecord, "status">,
  invitees: readonly Pick<MeetingInviteeRecord, "emailNormalized" | "role">[],
): boolean {
  if (meeting.status !== "active") return false;
  return hasMeetingEditRole(user, invitees);
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

/**
 * 会議の編集・再同期・取り消しアクセス検証を行う。
 * - 会議が存在しない、または無関係な第三者は 404
 * - 閲覧可能だが `cohost` でも管理者でもない一般参加者は 403
 * - `status !== "active"`（`canceled` / `failed` 等）の会議は 409
 */
export async function requireMeetingEditAccess(
  env: Env,
  request: Request,
  meetingId: string,
  deps: AccessDeps = {},
): Promise<MeetingViewAccess> {
  const access = await requireMeetingViewAccess(env, request, meetingId, deps);
  if (!hasMeetingEditRole(access.user, access.invitees)) {
    throw new Response("Forbidden", { status: 403 });
  }
  if (access.meeting.status !== "active") {
    throw new Response("Conflict", { status: 409 });
  }
  return access;
}
