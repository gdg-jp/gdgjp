import { zodSchema } from "ai";
import { describe, expect, it } from "vitest";
import { ClarificationResultSchema } from "../../../../shared/ingestion/domain";
import { OperationPlanOutputSchema } from "./operation-plan-output";
import { PageDraftOutputSchema, SectionPatchResponseOutputSchema } from "./page-content-output";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unsupportedFeatures(value: unknown, path = "schema"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => unsupportedFeatures(item, `${path}[${index}]`));
  }
  if (!isRecord(value)) return [];
  const failures: string[] = [];
  if (Array.isArray(value.oneOf)) failures.push(`${path}.oneOf`);
  if (Array.isArray(value.anyOf)) {
    const nullBranches = value.anyOf.filter((branch) => isRecord(branch) && branch.type === "null");
    if (value.anyOf.length !== 2 || nullBranches.length !== 1) failures.push(`${path}.anyOf`);
  }
  if (isRecord(value.additionalProperties)) failures.push(`${path}.additionalProperties`);
  if (Array.isArray(value.enum) && value.enum.some((entry) => typeof entry !== "string")) {
    failures.push(`${path}.enum`);
  }
  for (const [key, child] of Object.entries(value)) {
    failures.push(...unsupportedFeatures(child, `${path}.${key}`));
  }
  return failures;
}

describe("Gemini provider schema compatibility", () => {
  it("keeps every ingestion output free of unsupported schema constructs", () => {
    const schemas = [
      ["clarification", zodSchema(ClarificationResultSchema).jsonSchema],
      ["plan", zodSchema(OperationPlanOutputSchema).jsonSchema],
      ["pageDraft", zodSchema(PageDraftOutputSchema).jsonSchema],
      ["sectionPatch", zodSchema(SectionPatchResponseOutputSchema).jsonSchema],
    ] as const;

    for (const [name, schema] of schemas) {
      expect(unsupportedFeatures(schema), name).toEqual([]);
    }
  });
});
