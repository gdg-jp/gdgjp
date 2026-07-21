import type { AiDraftJson } from "../../../../../shared/ingestion/domain";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Draft JSON predates this layer and is intentionally decoded conservatively.
 * We only require its stable discriminator/shape; program-level schemas remain
 * responsible for validating the fields they consume.
 */
export function parseIngestionDraft(value: string | null): AiDraftJson | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return null;
    if (parsed.phase === "clarification" || parsed.phase === "url_selection") {
      return Array.isArray(parsed.fileUris) ? (parsed as AiDraftJson) : null;
    }
    if (
      parsed.phase === "resume_post_clarification" ||
      parsed.phase === "resume_post_url_selection"
    ) {
      return Array.isArray(parsed.fileUris) ? (parsed as AiDraftJson) : null;
    }
    // Result drafts historically have either phase: "result" or no phase.
    if (!Array.isArray(parsed.operations)) return null;
    return {
      ...parsed,
      operations: parsed.operations.map((operation) =>
        isRecord(operation) && !Array.isArray(operation.evidencePaths)
          ? { ...operation, evidencePaths: [] }
          : operation,
      ),
    } as AiDraftJson;
  } catch {
    return null;
  }
}

export function stringifyIngestionDraft(draft: AiDraftJson): string {
  return JSON.stringify(draft);
}
