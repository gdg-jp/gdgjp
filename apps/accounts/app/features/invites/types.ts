export const INVITE_EXPIRY_DAYS = [1, 7, 30] as const;
export type InviteExpiryDays = (typeof INVITE_EXPIRY_DAYS)[number];
export const DEFAULT_INVITE_EXPIRY_DAYS: InviteExpiryDays = 7;

export type InviteChapter = { id: number; slug: string; name: string };

export type Invite = {
  id: string;
  token: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  chapters: InviteChapter[];
};

export type InviteSummary = Invite & {
  creator: { name: string; email: string } | null;
};

export type InviteState = "valid" | "expired" | "revoked";

export type InviteJoinOutcome = InviteChapter & { joined: boolean };
