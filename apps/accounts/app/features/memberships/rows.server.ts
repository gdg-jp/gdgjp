import type { ChapterKind, ChapterRegion } from "~/features/chapters/types";
import type { Membership, MembershipStatus, MembershipWithChapter, Role } from "./types";

export type MembershipRow = {
  user_id: string;
  chapter_id: number;
  role: Role;
  status: MembershipStatus;
  created_at: number;
  approved_at: number | null;
};

export type MembershipJoinRow = MembershipRow & {
  c_id: number;
  c_slug: string;
  c_name: string;
  c_kind: ChapterKind;
  c_region: ChapterRegion;
  c_created_at: number;
};

export function toMembership(row: MembershipRow): Membership {
  return {
    userId: row.user_id,
    chapterId: row.chapter_id,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
  };
}

export function toMembershipWithChapter(row: MembershipJoinRow): MembershipWithChapter {
  return {
    ...toMembership(row),
    chapter: {
      id: row.c_id,
      slug: row.c_slug,
      name: row.c_name,
      kind: row.c_kind,
      region: row.c_region,
      createdAt: row.c_created_at,
    },
  };
}

export const MEMBERSHIP_JOIN_COLS = `
  m.user_id, m.chapter_id, m.role, m.status, m.created_at, m.approved_at,
  c.id   AS c_id,
  c.slug AS c_slug,
  c.name AS c_name,
  c.kind AS c_kind,
  c.region AS c_region,
  c.created_at AS c_created_at
`;
