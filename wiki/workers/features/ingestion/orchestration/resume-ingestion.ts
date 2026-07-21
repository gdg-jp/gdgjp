import type {
  ClarificationAnswer,
  IngestionWorkflowPhase,
} from "../../../../shared/ingestion/commands";
import type {
  AiDraftJson,
  IngestionResumePostClarificationDraft,
  IngestionResumePostUrlSelectionDraft,
} from "../../../../shared/ingestion/domain";

type WaitingStatus = "awaiting_url_selection" | "awaiting_clarification";

export interface ResumeSession {
  id: string;
  userId: string;
  status: string;
  draft: AiDraftJson | null;
  workflowId: string | null;
}

export interface ResumeSessionRepository {
  findById(sessionId: string): Promise<ResumeSession | null>;
  transition(
    sessionId: string,
    expected: readonly WaitingStatus[] | readonly ["processing"],
    next: WaitingStatus | "processing",
    patch?: { phaseMessage?: string | null; draft?: AiDraftJson | null },
  ): Promise<boolean>;
  setWorkflowId(sessionId: string, workflowId: string): Promise<void>;
}

export interface PreparedResume {
  sessionId: string;
  userId: string;
  previousDraft: AiDraftJson;
  phase: Extract<IngestionWorkflowPhase, "post_url_selection" | "post_clarification">;
  waitingStatus: WaitingStatus;
}

export async function prepareClarificationResume(
  sessions: ResumeSessionRepository,
  sessionId: string,
  answers: readonly ClarificationAnswer[],
): Promise<PreparedResume> {
  const session = await sessions.findById(sessionId);
  if (!session || session.status !== "awaiting_clarification" || !session.workflowId) {
    throw new Error("Session is not awaiting clarification");
  }
  if (!session.draft || session.draft.phase !== "clarification") {
    throw new Error("Invalid stored clarification state");
  }
  const previousDraft = session.draft;
  const clarificationAnswers = [
    "## 補足情報（ユーザーへの確認結果）",
    ...answers.map((answer) => `Q: ${answer.question}\nA: ${answer.answer}`),
  ].join("\n");
  const draft: IngestionResumePostClarificationDraft = {
    phase: "resume_post_clarification",
    fileUris: previousDraft.fileUris,
    clarificationAnswers,
    sources: previousDraft.sources,
  };
  const transitioned = await sessions.transition(
    sessionId,
    ["awaiting_clarification"],
    "processing",
    { draft, phaseMessage: "parsing" },
  );
  if (!transitioned) throw new Error("Clarification was already submitted");
  return {
    sessionId,
    userId: session.userId,
    previousDraft,
    phase: "post_clarification",
    waitingStatus: "awaiting_clarification",
  };
}

export async function prepareUrlSelectionResume(
  sessions: ResumeSessionRepository,
  sessionId: string,
  selectedUrls: readonly string[],
): Promise<PreparedResume> {
  const session = await sessions.findById(sessionId);
  if (!session || session.status !== "awaiting_url_selection" || !session.workflowId) {
    throw new Error("Session is not awaiting URL selection");
  }
  if (!session.draft || session.draft.phase !== "url_selection") {
    throw new Error("Invalid stored URL selection state");
  }
  const allowed = new Set(session.draft.urls.map((candidate) => candidate.url));
  if (selectedUrls.some((url) => !allowed.has(url))) {
    throw new Error("Selected URLs are not in the allowed list");
  }
  const previousDraft = session.draft;
  const draft: IngestionResumePostUrlSelectionDraft = {
    phase: "resume_post_url_selection",
    fileUris: previousDraft.fileUris,
    selectedUrls: [...selectedUrls],
    sources: previousDraft.sources,
    skipClarification: previousDraft.skipClarification,
  };
  const transitioned = await sessions.transition(
    sessionId,
    ["awaiting_url_selection"],
    "processing",
    { draft, phaseMessage: "fetching_urls" },
  );
  if (!transitioned) throw new Error("URL selection was already submitted");
  return {
    sessionId,
    userId: session.userId,
    previousDraft,
    phase: "post_url_selection",
    waitingStatus: "awaiting_url_selection",
  };
}

export function rollbackResume(
  sessions: ResumeSessionRepository,
  resume: PreparedResume,
): Promise<boolean> {
  return sessions.transition(resume.sessionId, ["processing"], resume.waitingStatus, {
    draft: resume.previousDraft,
    phaseMessage: null,
  });
}
