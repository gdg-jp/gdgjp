/**
 * Draft review flow (overview §2-10): generating → in_review → needs_approval → approved, with
 * request-changes back to drafting. A reviewer who is also an approver may approve straight from
 * in_review (a one-person team), but nothing skips in_review.
 */
export type DraftStatus =
  | "generating"
  | "drafting"
  | "in_review"
  | "needs_approval"
  | "approved"
  | "rejected"
  | "superseded";

export type ReviewAction = "submit" | "review_ok" | "request_changes" | "approve" | "reject";

export type Actor = { canReview: boolean; canApprove: boolean };

export function nextStatus(
  current: DraftStatus,
  action: ReviewAction,
  actor: Actor,
): DraftStatus | null {
  switch (action) {
    case "submit":
      return current === "drafting" || current === "generating" ? "in_review" : null;
    case "review_ok":
      return current === "in_review" && actor.canReview ? "needs_approval" : null;
    case "request_changes":
      if (current === "in_review" && actor.canReview) return "drafting";
      if (current === "needs_approval" && actor.canApprove) return "drafting";
      return null;
    case "approve":
      if (current === "needs_approval" && actor.canApprove) return "approved";
      if (current === "in_review" && actor.canApprove && actor.canReview) return "approved";
      return null;
    case "reject":
      return (current === "in_review" || current === "needs_approval") && actor.canApprove
        ? "rejected"
        : null;
  }
}

/** After a human edit, the draft goes back to review (an approved draft must be re-approved). */
export function statusAfterEdit(current: DraftStatus): DraftStatus {
  return current === "rejected" || current === "superseded" ? current : "in_review";
}

/** Schedule item status that mirrors a draft status. */
export function itemStatusFor(
  status: DraftStatus,
): "drafting" | "in_review" | "needs_approval" | "approved" | "planned" {
  switch (status) {
    case "generating":
    case "drafting":
      return "drafting";
    case "in_review":
      return "in_review";
    case "needs_approval":
      return "needs_approval";
    case "approved":
      return "approved";
    default:
      return "planned";
  }
}

export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  generating: "生成中",
  drafting: "修正中",
  in_review: "レビュー待ち",
  needs_approval: "承認待ち",
  approved: "承認済み",
  rejected: "却下",
  superseded: "差し替え済み",
};
