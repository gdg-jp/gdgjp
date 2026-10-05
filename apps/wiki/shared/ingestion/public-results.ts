import type { IngestionSnapshot, IngestionStatus } from "./agent-state";
import type { IngestionPhase, IngestionWorkflowPhase } from "./commands";

/** The phases which can be scheduled as a standalone Workflow instance. */
export type WorkflowPhase = IngestionWorkflowPhase;

export type { IngestionPhase, IngestionSnapshot, IngestionStatus };

export type PhaseOutcome =
  | { kind: "awaiting_url_selection" }
  | { kind: "awaiting_clarification" }
  | { kind: "completed" };

export interface RegenerateResult<Operation = unknown> {
  operation: Operation;
}

export interface IngestionAcceptedResult {
  accepted: true;
}
