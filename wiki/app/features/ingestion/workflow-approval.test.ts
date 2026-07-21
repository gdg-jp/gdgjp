import { describe, expect, it } from "vitest";
import { assertWorkflowApprovalKind } from "./workflow-approval";

describe("assertWorkflowApprovalKind", () => {
  it("accepts the metadata object returned by AgentWorkflow.waitForApproval", () => {
    expect(() =>
      assertWorkflowApprovalKind({ kind: "url_selection" }, "url_selection"),
    ).not.toThrow();
    expect(() =>
      assertWorkflowApprovalKind({ kind: "clarification" }, "clarification"),
    ).not.toThrow();
  });

  it("rejects metadata for a different approval step", () => {
    expect(() => assertWorkflowApprovalKind({ kind: "clarification" }, "url_selection")).toThrow(
      "Unexpected url selection approval payload",
    );
    expect(() => assertWorkflowApprovalKind(undefined, "url_selection")).toThrow(
      "Unexpected url selection approval payload",
    );
  });
});
