import type { CheckResult } from "@skills/pr-playbook/scripts/checks/index.mjs";
import type { DraftKind } from "./draft-kinds";
import type { DraftStatus } from "./state-machine";

export type Draft = {
  id: number;
  campaignId: number;
  kind: DraftKind;
  scheduleItemId: number | null;
  title: string;
  currentVersion: number;
  status: DraftStatus;
  assigneeUserId: string | null;
  reviewerUserId: string | null;
  reviewedBy: string | null;
  approvedBy: string | null;
  approvedAt: number | null;
  dispatchMediaUrl: string | null;
  createdAt: number;
  updatedAt: number;
};

export type DraftVersion = {
  id: number;
  draftId: number;
  version: number;
  author: "agent" | "human";
  userId: string | null;
  jobId: string | null;
  content: unknown;
  playbookVersion: string;
  checkResults: CheckResult[];
  createdAt: number;
};

export type DraftReview = {
  id: number;
  version: number;
  userId: string;
  decision: "approve" | "request_changes" | "reject";
  stage: "review" | "approval";
  comment: string | null;
  createdAt: number;
};

export const mustFailCount = (results: CheckResult[]) =>
  results.filter((r) => r.strength === "MUST" && r.status === "fail").length;
