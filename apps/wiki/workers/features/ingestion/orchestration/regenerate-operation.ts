import type { ChangesetOperation } from "../../../../shared/ingestion/domain";
import type { ExecutionEventSink } from "./ports/tool-event-sink";

export interface RegenerateOperationCommand {
  sessionId: string;
  userId: string;
  operationIndex: number;
  feedback?: string;
}

export interface OperationRegenerator {
  regenerate(
    command: RegenerateOperationCommand,
    events: ExecutionEventSink,
  ): Promise<ChangesetOperation>;
}
