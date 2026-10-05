/** Commands that cross the presentation-to-agent boundary. */

export type IngestionWorkflowPhase =
  | "initial"
  | "post_url_selection"
  | "post_clarification"
  | "regeneration";

/** A durable ingestion phase, including waiting and terminal projections. */
export type IngestionPhase =
  | "initial"
  | "url_selection"
  | "post_url_selection"
  | "clarification"
  | "post_clarification"
  | "regeneration"
  | "completed"
  | "failed";

export interface StartIngestionCommand {
  sessionId: string;
}

export interface ClarificationAnswer {
  id: string;
  question: string;
  answer: string;
}

export interface ClarificationCommand {
  answers: ClarificationAnswer[];
}

export interface SelectUrlsCommand {
  selectedUrls: string[];
}

export interface RegenerateCommand {
  operationIndex: number;
  feedback?: string;
}
