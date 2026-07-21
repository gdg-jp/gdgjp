import type {
  ChangesetOperation,
  ClarificationResult,
  IngestionInputs,
  OperationPlan,
} from "../../../../../shared/ingestion/domain";
import type { ExecutionEventSink } from "./tool-event-sink";

export interface IngestionModelContext {
  actor: {
    userId: string;
    email: string;
    isAdmin: boolean;
    chapterIds: string[];
  };
  sourceText: string;
  inputs: IngestionInputs;
}

export interface IngestionModelGateway {
  clarify(context: IngestionModelContext, events: ExecutionEventSink): Promise<ClarificationResult>;
  plan(context: IngestionModelContext, events: ExecutionEventSink): Promise<OperationPlan>;
  generateOperations(
    context: IngestionModelContext,
    plan: OperationPlan,
    events: ExecutionEventSink,
  ): Promise<ChangesetOperation[]>;
}
