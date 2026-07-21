import type { IngestionInputs } from "./ingestion-pipeline.server";
export type {
  IngestionResumePostClarificationDraft,
  IngestionResumePostUrlSelectionDraft,
} from "./ingestion-pipeline.server";

export type IngestionResumeMode = "initial" | "post_clarification" | "post_url_selection";

export interface IngestionQueueMessage {
  kind: "ingestion";
  version: 2;
  sessionId: string;
  userId: string;
}

/** Internal execution request used by the durable workflow for each resumable phase. */
export interface IngestionExecutionRequest {
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
): IngestionQueueMessage {
  return { kind: "ingestion", version: 2, sessionId, userId };
}

export function isIngestionQueueMessage(body: unknown): body is IngestionQueueMessage {
  if (typeof body !== "object" || body === null) return false;
  const data = body as Record<string, unknown>;
  return (
    data.kind === "ingestion" &&
    data.version === 2 &&
    typeof data.sessionId === "string" &&
    typeof data.userId === "string"
  );
}

export function isLegacyIngestionQueueMessage(
  body: unknown,
): body is { kind: "ingestion"; sessionId: string; userId: string } {
  if (typeof body !== "object" || body === null) return false;
  const data = body as Record<string, unknown>;
  return (
    data.kind === "ingestion" &&
    data.version !== 2 &&
    typeof data.sessionId === "string" &&
    typeof data.userId === "string"
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
