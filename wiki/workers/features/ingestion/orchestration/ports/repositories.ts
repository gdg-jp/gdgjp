import type {
  AccessContext,
  AiDraftJson,
  ChangesetOperation,
  IngestionInputs,
} from "../../../../../shared/ingestion/domain";
import type {
  IngestionPhase,
  IngestionSnapshot,
  IngestionStatus,
  WorkflowPhase,
} from "../../../../../shared/ingestion/public-results";

export interface IngestionSessionRecord {
  id: string;
  userId: string;
  status: IngestionStatus;
  phase: IngestionPhase;
  workflowId: string | null;
  inputs: IngestionInputs;
  access: AccessContext;
  draft: AiDraftJson | null;
  manifest: Record<string, unknown>;
}

export interface IngestionSessionRepository {
  getOwned(sessionId: string, userId: string): Promise<IngestionSessionRecord | null>;
  getSnapshot(sessionId: string): Promise<IngestionSnapshot | null>;
  attachWorkflow(
    sessionId: string,
    userId: string,
    workflowId: string,
    phase: WorkflowPhase,
  ): Promise<boolean>;
  replaceOperation(
    sessionId: string,
    userId: string,
    operationIndex: number,
    operation: ChangesetOperation,
  ): Promise<void>;
}
