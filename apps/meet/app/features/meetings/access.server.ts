import type { AuthUser } from "@gdgjp/gdg-lib";
import { requireUser } from "~/features/auth/access.server";
import { sanitizeAvatarUrl } from "~/features/directory/directory";
import { normalizeEmail } from "~/features/google/email";
import type { MeetingInviteeRecord, MeetingRecord, PublicInvitee } from "./meeting";
import { getMeetingById, listMeetingInvitees } from "./meetings.repository.server";

export type MeetingViewAccess = {
  user: AuthUser;
  meeting: MeetingRecord;
  invitees: MeetingInviteeRecord[];
};

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

export function hasMeetingEditRole(
  user: Pick<AuthUser, "email" | "isAdmin">,
  invitees: readonly Pick<MeetingInviteeRecord, "emailNormalized" | "role">[],
): boolean {
  if (user.isAdmin) return true;
  const normalized = normalizeEmail(user.email);
  return invitees.some((inv) => inv.emailNormalized === normalized && inv.role === "cohost");
}

export function canEditMeeting(
  user: Pick<AuthUser, "email" | "isAdmin">,
  meeting: Pick<MeetingRecord, "status">,
  invitees: readonly Pick<MeetingInviteeRecord, "emailNormalized" | "role">[],
): boolean {
  if (meeting.status !== "active") return false;
  return hasMeetingEditRole(user, invitees);
}

export function toPublicInviteeList(
  invitees: readonly MeetingInviteeRecord[],
  avatarByEmail?: ReadonlyMap<string, string>,
): PublicInvitee[] {
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
      avatarUrl: sanitizeAvatarUrl(avatarByEmail?.get(invitee.emailNormalized)),
      role: invitee.role,
      isCreator,
      isChapterDerived,
    };
  });
}

type AccessDeps = {
  requireUserFn?: (env: Env, request: Request) => Promise<AuthUser>;
};

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
