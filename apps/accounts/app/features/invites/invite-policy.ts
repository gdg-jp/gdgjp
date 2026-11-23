import { INVITE_EXPIRY_DAYS, type Invite, type InviteExpiryDays, type InviteState } from "./types";

export function inviteState(
  invite: Pick<Invite, "expiresAt" | "revokedAt">,
  nowSeconds: number,
): InviteState {
  if (invite.revokedAt !== null) return "revoked";
  if (invite.expiresAt <= nowSeconds) return "expired";
  return "valid";
}

export function parseExpiryDays(raw: unknown): InviteExpiryDays | null {
  const days = Number(raw);
  return INVITE_EXPIRY_DAYS.find((allowed) => allowed === days) ?? null;
}

export function inviteUrl(appUrl: string, token: string): string {
  return new URL(`/invite/${encodeURIComponent(token)}`, appUrl).toString();
}

export function invitableChapterIds(
  memberships: ReadonlyArray<{ chapterId: number; role: string; status: string }>,
): number[] {
  return memberships
    .filter((m) => m.status === "active" && m.role === "organizer")
    .map((m) => m.chapterId);
}
