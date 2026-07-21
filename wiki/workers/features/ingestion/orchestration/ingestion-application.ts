import type { PhaseOutcome, WorkflowPhase } from "../../../../shared/ingestion/public-results";
import type { ExecutionEventSink } from "./ports/tool-event-sink";

export interface ExecuteIngestionPhaseCommand {
  sessionId: string;
  userId: string;
  phase: WorkflowPhase;
}

export interface IngestionPhaseRunner {
  execute(command: ExecuteIngestionPhaseCommand, events: ExecutionEventSink): Promise<PhaseOutcome>;
}

/** Framework-neutral application boundary used by Agent and Workflow adapters. */
export class IngestionApplication {
  constructor(private readonly phases: IngestionPhaseRunner) {}

  executePhase(
    command: ExecuteIngestionPhaseCommand,
    events: ExecutionEventSink,
  ): Promise<PhaseOutcome> {
    return this.phases.execute(command, events);
  }
}
