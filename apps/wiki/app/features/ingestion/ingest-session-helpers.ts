import type { ResolvedItem } from "~/features/ingestion/components/SensitiveReviewModal";
import type { AiDraftJson } from "../../../shared/ingestion/domain";

export type ResultDraft = Extract<AiDraftJson, { planRationale: string }>;

export function isClarification(
  draft: AiDraftJson | null,
): draft is Extract<AiDraftJson, { phase: "clarification" }> {
  return draft !== null && (draft as { phase?: string }).phase === "clarification";
}

export function isUrlSelection(
  draft: AiDraftJson | null,
): draft is Extract<AiDraftJson, { phase: "url_selection" }> {
  return draft !== null && (draft as { phase?: string }).phase === "url_selection";
}

export function isResultDraft(draft: AiDraftJson | null): draft is ResultDraft {
  if (!draft || typeof draft !== "object") return false;
  const data = draft as Record<string, unknown>;
  return (
    typeof data.planRationale === "string" &&
    Array.isArray(data.operations) &&
    Array.isArray(data.sensitiveItems) &&
    Array.isArray(data.warnings)
  );
}

function walkStrings(value: unknown, from: string, to: string): unknown {
  if (typeof value === "string") return value.split(from).join(to);
  if (Array.isArray(value)) return value.map((v) => walkStrings(v, from, to));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        walkStrings(v, from, to),
      ]),
    );
  }
  return value;
}

export function applySensitiveResolutions(
  draft: ResultDraft,
  resolutions: ResolvedItem[],
): ResultDraft {
  let result: unknown = draft;
  for (const { item, resolution } of resolutions) {
    if (resolution === "delete") {
      result = walkStrings(result, item.excerpt, "");
    } else if (resolution === "replace") {
      result = walkStrings(result, item.excerpt, "[要確認]");
    }
    // "keep" — do nothing
  }
  return result as ResultDraft;
}
