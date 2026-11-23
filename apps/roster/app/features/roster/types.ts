export type AssignmentRecord = {
  eventId: string;
  rosterSheetId: string;
  applicationId: string;
  timeSlotId: string;
  trackId: string;
  roleId: string;
  locked: boolean;
};

export const ROSTER_VIEWS = ["staff", "role", "coverage"] as const;
export type RosterView = (typeof ROSTER_VIEWS)[number];

export const ROSTER_VIEW_LABELS: Record<RosterView, string> = {
  staff: "スタッフ別",
  role: "役割別",
  coverage: "充足状況",
};
