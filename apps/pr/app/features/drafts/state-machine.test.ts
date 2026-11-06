import { describe, expect, it } from "vitest";
import { nextStatus, statusAfterEdit } from "./state-machine";

const reviewer = { canReview: true, canApprove: false };
const approver = { canReview: false, canApprove: true };
const both = { canReview: true, canApprove: true };
const nobody = { canReview: false, canApprove: false };

describe("draft state machine", () => {
  it("never goes from generating straight to approved", () => {
    expect(nextStatus("generating", "approve", both)).toBeNull();
  });
  it("needs a reviewer, then an approver", () => {
    expect(nextStatus("in_review", "review_ok", reviewer)).toBe("needs_approval");
    expect(nextStatus("in_review", "approve", approver)).toBeNull();
    expect(nextStatus("needs_approval", "approve", approver)).toBe("approved");
    expect(nextStatus("needs_approval", "approve", reviewer)).toBeNull();
  });
  it("lets one person who may do both approve from review", () => {
    expect(nextStatus("in_review", "approve", both)).toBe("approved");
  });
  it("sends requested changes back to drafting", () => {
    expect(nextStatus("in_review", "request_changes", reviewer)).toBe("drafting");
    expect(nextStatus("needs_approval", "request_changes", approver)).toBe("drafting");
    expect(nextStatus("in_review", "request_changes", nobody)).toBeNull();
  });
  it("re-reviews an approved draft after an edit", () => {
    expect(statusAfterEdit("approved")).toBe("in_review");
    expect(statusAfterEdit("drafting")).toBe("in_review");
  });
});
