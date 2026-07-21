import { zodSchema } from "ai";
import { describe, expect, it } from "vitest";
import { OperationPlanOutputSchema } from "./operation-plan-output";

describe("OperationPlanOutputSchema", () => {
  it("uses a flat provider schema without unsupported unions", () => {
    const providerSchema = zodSchema(OperationPlanOutputSchema).jsonSchema;
    const jsonSchema = JSON.stringify(providerSchema);

    expect(jsonSchema).not.toContain('"oneOf"');
    expect(jsonSchema).toContain('"suggestedTitle"');
    expect(jsonSchema).toContain('"pagePath"');
    expect(providerSchema).toMatchObject({
      properties: { operations: { minItems: 1, maxItems: 5 } },
    });
  });

  it("converts a create row into the strict domain operation", () => {
    const result = OperationPlanOutputSchema.parse({
      planRationale: "新規ページが必要です",
      operations: [
        {
          type: "create",
          suggestedTitle: { ja: "小さなドキュメント" },
          suggestedParentPath: null,
          pageType: "how-to-guide",
          pagePath: null,
          rationale: "既存ページがありません",
          evidencePaths: ["/google-docs/Small document"],
        },
      ],
    });

    expect(result.operations[0]).toMatchObject({
      type: "create",
      suggestedTitle: { ja: "小さなドキュメント" },
      suggestedParentPath: null,
    });
  });

  it("reports the branch-specific field when a create row is incomplete", () => {
    const result = OperationPlanOutputSchema.safeParse({
      planRationale: "新規ページが必要です",
      operations: [
        {
          type: "create",
          suggestedTitle: null,
          suggestedParentPath: null,
          pageType: null,
          pagePath: null,
          rationale: "既存ページがありません",
          evidencePaths: [],
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual([
        "operations.0.suggestedTitle",
        "operations.0.pageType",
      ]);
    }
  });

  it("rejects an empty plan before generation starts", () => {
    const result = OperationPlanOutputSchema.safeParse({
      planRationale: "操作は不要です",
      operations: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("operations");
    }
  });

  it("keeps only the model-selected workspace path for an update row", () => {
    const result = OperationPlanOutputSchema.parse({
      planRationale: "既存ページを更新します",
      operations: [
        {
          type: "update",
          suggestedTitle: null,
          suggestedParentPath: null,
          pageType: null,
          pagePath: "/wiki/tips-for-hands-on-preparation",
          rationale: "同じ主題のページです",
          evidencePaths: ["/wiki/tips-for-hands-on-preparation"],
        },
      ],
    });

    expect(result.operations[0]).toEqual({
      type: "update",
      pagePath: "/wiki/tips-for-hands-on-preparation",
      rationale: "同じ主題のページです",
      evidencePaths: ["/wiki/tips-for-hands-on-preparation"],
    });
  });
});
