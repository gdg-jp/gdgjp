import { zodSchema } from "ai";
import { describe, expect, it } from "vitest";
import { OperationPlanOutputSchema } from "./operation-plan-output";

describe("OperationPlanOutputSchema", () => {
  it("uses a flat provider schema without unsupported unions", () => {
    const jsonSchema = JSON.stringify(zodSchema(OperationPlanOutputSchema).jsonSchema);

    expect(jsonSchema).not.toContain('"oneOf"');
    expect(jsonSchema).toContain('"suggestedTitle"');
    expect(jsonSchema).toContain('"pageId"');
  });

  it("converts a create row into the strict domain operation", () => {
    const result = OperationPlanOutputSchema.parse({
      planRationale: "新規ページが必要です",
      operations: [
        {
          type: "create",
          suggestedTitle: { ja: "小さなドキュメント" },
          suggestedParentId: null,
          pageType: "how-to-guide",
          pageId: null,
          pageTitle: null,
          rationale: "既存ページがありません",
          evidencePaths: ["/google-docs/Small document"],
        },
      ],
    });

    expect(result.operations[0]).toMatchObject({
      type: "create",
      suggestedTitle: { ja: "小さなドキュメント" },
      tempId: expect.any(String),
    });
  });

  it("reports the branch-specific field when a create row is incomplete", () => {
    const result = OperationPlanOutputSchema.safeParse({
      planRationale: "新規ページが必要です",
      operations: [
        {
          type: "create",
          suggestedTitle: null,
          suggestedParentId: null,
          pageType: null,
          pageId: null,
          pageTitle: null,
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
});
