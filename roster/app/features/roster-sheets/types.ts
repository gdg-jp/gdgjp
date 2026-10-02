export type SheetVisibility = "private" | "published";

export type RosterSheet = {
  id: string;
  eventId: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  stepMin: number;
  noSoloNewcomer: boolean;
  maxConsecutive: number;
  seed: number;
  visibility: SheetVisibility;
  sortOrder: number;
  revisionCursor: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
