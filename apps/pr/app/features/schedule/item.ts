import type { ItemStatus, ScheduleKind } from "./kinds";

export type RequestStatus = "sent" | "replied" | "declined";

export type ScheduleItem = {
  id: number;
  campaignId: number;
  kind: ScheduleKind;
  channel: string | null;
  dueAt: number;
  title: string;
  note: string | null;
  draftId: number | null;
  assigneeUserId: string | null;
  reviewerUserId: string | null;
  requiresApproval: boolean;
  status: ItemStatus;
  blockedBy: string[];
  requestStatus: RequestStatus | null;
  requestFollowupAt: number | null;
  externalRef: Record<string, unknown> | null;
  derivedFromItemId: number | null;
  offsetMinutes: number | null;
  speakerId: string | null;
  sessionId: string | null;
  purpose: string | null;
  variant: string | null;
  planVersion: number | null;
  createdAt: number;
  updatedAt: number;
};

/** What a caller supplies to create an item (derived items are computed). */
export type ItemInput = {
  kind: ScheduleKind;
  channel?: string | null;
  dueAt: number;
  title: string;
  note?: string | null;
  assigneeUserId?: string | null;
  reviewerUserId?: string | null;
  requiresApproval?: boolean;
  blockedBy?: string[];
  requestStatus?: RequestStatus | null;
  requestFollowupAt?: number | null;
  speakerId?: string | null;
  sessionId?: string | null;
  purpose?: string | null;
  variant?: string | null;
  planVersion?: number | null;
  offsetMinutes?: number | null;
  status?: ItemStatus;
};
