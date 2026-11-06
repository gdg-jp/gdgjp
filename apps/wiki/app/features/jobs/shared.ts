// Client-safe job vocabulary (Stage 02 / 04).

export type AgentJobType = "synthesize" | "answer" | "consolidate" | "translate";
export type AgentJobStatus =
  | "queued"
  | "leased"
  | "succeeded"
  | "failed"
  | "needs_review"
  | "expired";

export const JOB_PRIORITY = {
  answer: 10,
  manual: 5,
  synthesize: 0,
  translate: -5,
  consolidate: -10,
} as const;

/** A human's request, from a page's "ask the agent" button (Stage 04 §3-4). */
export type SynthesizeRequest = {
  pageSlug: string;
  text: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: number;
};

export type SynthesizePayload = {
  sourceIds: string[];
  documentIds: string[];
  requests?: SynthesizeRequest[];
};

/** Synthesize runs at most once an hour per space (the runner shares a personal quota). */
export const SYNTHESIZE_MIN_INTERVAL_SECONDS = 60 * 60;
