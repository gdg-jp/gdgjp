import type {
  IngestionPhase,
  IngestionStatus,
  WorkflowPhase,
} from "../../../../shared/ingestion/public-results";

export type IngestionTransitionEvent =
  | { type: "start_phase"; phase: WorkflowPhase }
  | { type: "request_url_selection" }
  | { type: "submit_url_selection" }
  | { type: "request_clarification" }
  | { type: "submit_clarification" }
  | { type: "complete" }
  | { type: "fail" };

export interface IngestionMachineState {
  status: IngestionStatus;
  phase: IngestionPhase;
}

export class InvalidIngestionTransitionError extends Error {
  constructor(state: IngestionMachineState, event: IngestionTransitionEvent) {
    super(`Invalid ingestion transition: ${state.status}/${state.phase} -> ${event.type}`);
    this.name = "InvalidIngestionTransitionError";
  }
}

export function transitionIngestion(
  state: IngestionMachineState,
  event: IngestionTransitionEvent,
): IngestionMachineState {
  switch (event.type) {
    case "start_phase":
      if (
        state.status !== "processing" &&
        !(state.status === "awaiting_url_selection" && event.phase === "post_url_selection") &&
        !(state.status === "awaiting_clarification" && event.phase === "post_clarification") &&
        !(state.status === "done" && event.phase === "regeneration")
      ) {
        break;
      }
      return { status: "processing", phase: event.phase };
    case "request_url_selection":
      if (state.status === "processing" && state.phase === "initial") {
        return { status: "awaiting_url_selection", phase: "url_selection" };
      }
      break;
    case "submit_url_selection":
      if (state.status === "awaiting_url_selection") {
        return { status: "processing", phase: "post_url_selection" };
      }
      break;
    case "request_clarification":
      if (state.status === "processing") {
        return { status: "awaiting_clarification", phase: "clarification" };
      }
      break;
    case "submit_clarification":
      if (state.status === "awaiting_clarification") {
        return { status: "processing", phase: "post_clarification" };
      }
      break;
    case "complete":
      if (state.status === "processing") return { status: "done", phase: "completed" };
      break;
    case "fail":
      if (state.status !== "done") return { status: "error", phase: "failed" };
      break;
  }
  throw new InvalidIngestionTransitionError(state, event);
}
