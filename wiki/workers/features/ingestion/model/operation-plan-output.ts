import { z } from "zod";
import {
  CreateOperationSchema,
  type OperationPlan,
  UpdateOperationSchema,
} from "../../../../shared/ingestion/domain";

const ProviderOperationSchema = z
  .object({
    type: z.enum(["create", "update"]),
    suggestedTitle: CreateOperationSchema.shape.suggestedTitle.nullable(),
    suggestedParentId: CreateOperationSchema.shape.suggestedParentId,
    pageType: CreateOperationSchema.shape.pageType.nullable(),
    pageId: UpdateOperationSchema.shape.pageId.nullable(),
    pageTitle: UpdateOperationSchema.shape.pageTitle.nullable(),
    rationale: z.string(),
    evidencePaths: z.array(z.string().min(1)).max(12),
  })
  .superRefine((operation, context) => {
    if (operation.type === "create") {
      if (!operation.suggestedTitle) {
        context.addIssue({
          code: "custom",
          path: ["suggestedTitle"],
          message: "suggestedTitle is required for create operations",
        });
      }
      if (!operation.pageType) {
        context.addIssue({
          code: "custom",
          path: ["pageType"],
          message: "pageType is required for create operations",
        });
      }
      return;
    }
    if (!operation.pageId) {
      context.addIssue({
        code: "custom",
        path: ["pageId"],
        message: "pageId is required for update operations",
      });
    }
    if (!operation.pageTitle) {
      context.addIssue({
        code: "custom",
        path: ["pageTitle"],
        message: "pageTitle is required for update operations",
      });
    }
  })
  .transform((operation) => {
    if (operation.type === "create") {
      return CreateOperationSchema.parse({
        type: "create",
        tempId: crypto.randomUUID(),
        suggestedTitle: operation.suggestedTitle,
        suggestedParentId: operation.suggestedParentId,
        pageType: operation.pageType,
        rationale: operation.rationale,
        evidencePaths: operation.evidencePaths,
      });
    }
    return UpdateOperationSchema.parse({
      type: "update",
      pageId: operation.pageId,
      pageTitle: operation.pageTitle,
      rationale: operation.rationale,
      evidencePaths: operation.evidencePaths,
    });
  });

/**
 * Gemini structured output supports only a subset of OpenAPI schemas and does
 * not reliably support unions. Keep the provider-facing shape flat, then
 * convert each validated row into the strict domain union.
 */
export const OperationPlanOutputSchema: z.ZodType<OperationPlan> = z.object({
  planRationale: z.string(),
  operations: z
    .array(ProviderOperationSchema)
    .max(5)
    .describe(
      "For create, set suggestedTitle and pageType and set pageId/pageTitle to null. " +
        "For update, set pageId/pageTitle and set suggestedTitle/suggestedParentId/pageType to null.",
    ),
});
