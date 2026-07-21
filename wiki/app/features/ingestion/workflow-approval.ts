export type WorkflowApprovalKind = "url_selection" | "clarification";

export interface WorkflowApprovalMetadata {
  kind: WorkflowApprovalKind;
}

export function assertWorkflowApprovalKind(
  metadata: unknown,
  expected: WorkflowApprovalKind,
): asserts metadata is WorkflowApprovalMetadata {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    !("kind" in metadata) ||
    metadata.kind !== expected
  ) {
    throw new Error(`Unexpected ${expected.replace("_", " ")} approval payload`);
  }
}
