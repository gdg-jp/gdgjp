import { z } from "zod";

export const leaseUpdateSchema = z.object({ attempts: z.number().int().nonnegative() });
export type LeaseUpdate = z.infer<typeof leaseUpdateSchema>;

export const jobResultSchema = leaseUpdateSchema.extend({
  status: z.enum(["succeeded", "failed", "needs_review"]),
  result: z.unknown().optional(),
  error: z.string().optional(),
  integratedDocumentIds: z.array(z.string()).optional(),
  requestOutcomes: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        applied: z.boolean(),
        note: z.string().optional(),
      }),
    )
    .optional(),
  retry: z.boolean().optional(),
  reviewFlag: z
    .object({ kind: z.literal("acl-untagged"), payload: z.unknown().optional() })
    .optional(),
});
export type JobResult = z.infer<typeof jobResultSchema>;
