import type { UserChapter } from "@gdgjp/gdg-lib";
import type { CampaignAccount } from "~/features/integrations/account";
import type { ItemStatus } from "~/features/schedule/kinds";

export const TARGET_STATUSES = [
  "pending",
  "approved",
  "dispatching",
  "scheduled",
  "done",
  "failed",
  "skipped",
  "delegated",
] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

export const TARGET_STATUS_LABELS: Record<TargetStatus, string> = {
  pending: "配信先の承認待ち",
  approved: "承認済み",
  dispatching: "配信中",
  scheduled: "予約済み",
  done: "投稿済み",
  failed: "失敗",
  skipped: "見送り",
  delegated: "依頼に回した",
};

export type TargetRef = {
  snsPostId?: string;
  publishedXPostId?: string | null;
  connpassJobId?: string;
};

export type DispatchTarget = {
  id: number;
  scheduleItemId: number;
  accountId: number;
  status: TargetStatus;
  approvedBy: string | null;
  approvedAt: number | null;
  externalRef: TargetRef | null;
  error: string | null;
  account: CampaignAccount;
};

/** Kinds that go out through sns (one target per X account) or connpass (per group). */
export const DISPATCH_KINDS = ["x_post", "live_post", "connpass_mail"] as const;
export const targetAccountKind = (kind: string) =>
  kind === "connpass_mail" ? "connpass_group" : "x";
export const isDispatchKind = (kind: string) =>
  (DISPATCH_KINDS as readonly string[]).includes(kind);

/**
 * Only someone in the account's chapter approves its target (overview §2-11): a host lead
 * cannot post on a co-host chapter's account. sns checks the same actor again.
 */
export function canApproveTarget(
  account: Pick<CampaignAccount, "chapterId">,
  viewer: { chapters: UserChapter[]; isMember: boolean; isAdmin: boolean },
): boolean {
  const chapter = viewer.chapters.find((c) => c.chapterId === account.chapterId);
  if (!chapter) return false;
  return viewer.isMember || viewer.isAdmin || chapter.role === "organizer";
}

const SETTLED: readonly TargetStatus[] = ["scheduled", "done", "skipped", "delegated"];
const FINISHED: readonly TargetStatus[] = ["done", "skipped", "delegated"];

/** The item's status once every target has moved on; null while any is still open. */
export function rollupItemStatus(statuses: TargetStatus[]): ItemStatus | null {
  if (statuses.length === 0) return null;
  if (statuses.every((s) => FINISHED.includes(s))) return "done";
  if (statuses.every((s) => SETTLED.includes(s))) return "scheduled";
  if (statuses.includes("failed") && !statuses.some((s) => s === "dispatching" || s === "approved"))
    return "failed";
  return null;
}
