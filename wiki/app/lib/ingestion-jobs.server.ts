import type { IngestionInputs } from "./ingestion-pipeline.server";
export type {
  IngestionResumePostClarificationDraft,
  IngestionResumePostUrlSelectionDraft,
} from "./ingestion-pipeline.server";

export type IngestionResumeMode = "initial" | "post_clarification" | "post_url_selection";

export interface IngestionQueueMessage {
  kind: "ingestion";
  sessionId: string;
  userId: string;
  resumeMode: IngestionResumeMode;
}

type SessionInputsJson = {
  texts: string[];
  imageKeys: string[];
  googleDocUrls: string[];
  pdfKeys?: string[];
  googleFormUrl?: string;
  eventTitle?: string;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function buildIngestionQueueMessage(
  sessionId: string,
  userId: string,
  resumeMode: IngestionResumeMode,
): IngestionQueueMessage {
  return { kind: "ingestion", sessionId, userId, resumeMode };
}

export function isIngestionQueueMessage(body: unknown): body is IngestionQueueMessage {
  if (typeof body !== "object" || body === null) return false;
  const data = body as Record<string, unknown>;
  return (
    data.kind === "ingestion" &&
    typeof data.sessionId === "string" &&
    typeof data.userId === "string" &&
    (data.resumeMode === "initial" ||
      data.resumeMode === "post_clarification" ||
      data.resumeMode === "post_url_selection")
  );
}

export function parseSessionInputsJson(inputsJson: string): IngestionInputs {
  const parsed = JSON.parse(inputsJson) as SessionInputsJson;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !isStringArray(parsed.texts) ||
    !isStringArray(parsed.imageKeys) ||
    !isStringArray(parsed.googleDocUrls) ||
    (parsed.pdfKeys !== undefined && !isStringArray(parsed.pdfKeys))
  ) {
    throw new Error("Invalid session inputs");
  }

  return {
    texts: parsed.texts,
    imageKeys: parsed.imageKeys,
    googleDocUrls: parsed.googleDocUrls,
    pdfKeys: parsed.pdfKeys ?? [],
    googleFormUrl: parsed.googleFormUrl,
    eventTitle: parsed.eventTitle,
  };
}
