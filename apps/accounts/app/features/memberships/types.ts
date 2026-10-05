import type { Chapter } from "~/features/chapters/types";

export type Role = "organizer" | "member";
export type MembershipStatus = "pending" | "active";

export type UserChapter = {
  chapterId: number;
  chapterSlug: string;
  role: Role;
};

export type Membership = {
  userId: string;
  chapterId: number;
  role: Role;
  status: MembershipStatus;
  createdAt: number;
  approvedAt: number | null;
};

export type MembershipWithChapter = Membership & { chapter: Chapter };

export type PendingRequestWithChapter = Membership & {
  chapter: Chapter;
  user: { id: string; email: string; name: string };
};
