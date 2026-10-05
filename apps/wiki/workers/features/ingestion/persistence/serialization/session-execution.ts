import type { IngestionInputs } from "../../../../../shared/ingestion/domain";

export type IngestionResumeMode = "initial" | "post_clarification" | "post_url_selection";

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
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseSessionInputsJson(inputsJson: string): IngestionInputs {
  const parsed: unknown = JSON.parse(inputsJson);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid session inputs");
  const input = parsed as Record<string, unknown>;
  if (
    !isStringArray(input.texts) ||
    !isStringArray(input.imageKeys) ||
    !isStringArray(input.googleDocUrls) ||
    (input.pdfKeys !== undefined && !isStringArray(input.pdfKeys)) ||
    (input.googleFormUrl !== undefined && typeof input.googleFormUrl !== "string") ||
    (input.eventTitle !== undefined && typeof input.eventTitle !== "string")
  ) {
    throw new Error("Invalid session inputs");
  }
  return {
    texts: input.texts,
    imageKeys: input.imageKeys,
    googleDocUrls: input.googleDocUrls,
    pdfKeys: input.pdfKeys ?? [],
    googleFormUrl: input.googleFormUrl,
    eventTitle: input.eventTitle,
  } satisfies SessionInputsJson;
}
