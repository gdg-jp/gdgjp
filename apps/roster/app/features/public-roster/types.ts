import type { PartyStatus } from "~/features/applications/types";

export type PublicEventSummary = {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  hasParty: boolean;
  sheet: { name: string; date: string; startTime: string; endTime: string };
};

export type PublicSlot = { id: string; idx: number; startTime: string; endTime: string };
export type PublicTrack = { id: string; name: string; color: string };
export type PublicRole = { id: string; name: string };

export type PublicStaff = { id: string; name: string; party: PartyStatus };

export type PublicAssignment = {
  applicationId: string;
  timeSlotId: string;
  trackId: string;
  roleId: string;
};

export type PublicRosterData = {
  event: PublicEventSummary;
  slots: PublicSlot[];
  tracks: PublicTrack[];
  roles: PublicRole[];
  staff: PublicStaff[];
  assignments: PublicAssignment[];
};

export type PublicRosterView =
  | { published: false; event: PublicEventSummary }
  | { published: true; data: PublicRosterData };

export const PUBLIC_VIEWS = ["staff", "role", "person", "party"] as const;
export type PublicView = (typeof PUBLIC_VIEWS)[number];

export const PUBLIC_VIEW_LABELS: Record<PublicView, string> = {
  staff: "スタッフ別",
  role: "役割別",
  person: "個人",
  party: "懇親会",
};
