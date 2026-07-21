import type { IngestionInputs } from "../../../../../shared/ingestion/domain";

/**
 * The JSON shape stored in ingestion_sessions.inputs_json. File buffers are
 * deliberately excluded: attachments live in R2 and are referenced by key.
 */
export type PersistedIngestionInputs = Pick<
  IngestionInputs,
  "texts" | "imageKeys" | "googleDocUrls" | "pdfKeys" | "googleFormUrl" | "eventTitle"
>;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parsePersistedIngestionInputs(value: string): PersistedIngestionInputs {
  const parsed: unknown = JSON.parse(value);
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
  };
}

export function stringifyPersistedIngestionInputs(input: PersistedIngestionInputs): string {
  return JSON.stringify({
    texts: input.texts,
    imageKeys: input.imageKeys,
    googleDocUrls: input.googleDocUrls,
    pdfKeys: input.pdfKeys ?? [],
    googleFormUrl: input.googleFormUrl,
    eventTitle: input.eventTitle,
  });
}
