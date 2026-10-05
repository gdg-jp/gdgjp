import { z } from "zod";
import { type CreateOperation, CreateOperationSchema } from "../../../../shared/ingestion/domain";

export interface CreateOperationCandidate {
  type: "create";
  suggestedTitle: CreateOperation["suggestedTitle"];
  suggestedParentPath: string | null;
  pageType: CreateOperation["pageType"];
  rationale: string;
  evidencePaths: string[];
}

export interface UpdateOperationCandidate {
  type: "update";
  pagePath: string;
  rationale: string;
  evidencePaths: string[];
}

export interface OperationPlanCandidate {
  planRationale: string;
  operations: Array<CreateOperationCandidate | UpdateOperationCandidate>;
}

const ProviderOperationSchema = z
  .object({
    type: z.enum(["create", "update"]),
    suggestedTitle: CreateOperationSchema.shape.suggestedTitle.nullable(),
    suggestedParentPath: z.string().nullable(),
    pageType: CreateOperationSchema.shape.pageType.nullable(),
    pagePath: z.string().nullable(),
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
    if (!operation.pagePath) {
      context.addIssue({
        code: "custom",
        path: ["pagePath"],
        message: "pagePath is required for update operations",
      });
    }
  })
  .transform((operation) => {
    if (operation.type === "create") {
      return {
        type: "create",
        suggestedTitle: operation.suggestedTitle as CreateOperation["suggestedTitle"],
        suggestedParentPath: operation.suggestedParentPath,
        pageType: operation.pageType as CreateOperationCandidate["pageType"],
        rationale: operation.rationale,
        evidencePaths: operation.evidencePaths,
      } satisfies CreateOperationCandidate;
    }
    return {
      type: "update",
      pagePath: operation.pagePath as string,
      rationale: operation.rationale,
      evidencePaths: operation.evidencePaths,
    } satisfies UpdateOperationCandidate;
  });

/**
 * Gemini structured output supports only a subset of OpenAPI schemas and does
 * not reliably support unions. Keep the provider-facing shape flat, then
 * convert each validated row into the strict domain union.
 */
export const OperationPlanOutputSchema: z.ZodType<OperationPlanCandidate> = z.object({
  planRationale: z.string(),
  operations: z
    .array(ProviderOperationSchema)
    .min(1)
    .max(5)
    .describe(
      "Return one to five operations; never return an empty array. " +
        "For create, set suggestedTitle/pageType, optionally set suggestedParentPath to an exact " +
        "/wiki path that was read, and set pagePath to null. " +
        "For update, set pagePath to the exact /wiki path that was read and set " +
        "suggestedTitle/suggestedParentPath/pageType to null.",
    ),
});
