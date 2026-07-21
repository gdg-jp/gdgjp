import type { IngestionPhase } from "./commands";

export type IngestionStatus =
  | "idle"
  | "processing"
  | "awaiting_url_selection"
  | "awaiting_clarification"
  | "done"
  | "error";

/**
 * The intentionally small durable-object state that is synchronized to a
 * connected client. Full ingestion data remains in D1 and is read by loaders.
 */
export interface IngestionAgentState {
  sessionId: string | null;
  workflowId: string | null;
  phase: IngestionPhase | null;
  status: IngestionStatus;
  progress: { completed: number; total: number } | null;
  phaseMessage: string | null;
  errorMessage: string | null;
  revision: number;
}

/** Transitional wire shape accepted while older Agent instances are live. */
export type IngestionAgentStateWire = Partial<IngestionAgentState> & {
  sessionId?: string | null;
  workflowId?: string | null;
  status?: IngestionStatus;
  phaseMessage?: string | null;
  errorMessage?: string | null;
  revision?: number;
};

export interface IngestionSnapshot {
  sessionId: string;
  workflowId: string | null;
  phase: IngestionPhase | null;
  status: IngestionStatus;
  progress: { completed: number; total: number } | null;
  phaseMessage: string | null;
  errorMessage: string | null;
  revision: number;
}
