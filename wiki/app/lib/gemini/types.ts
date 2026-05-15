import { z } from "zod";

const SensitiveItemSchema = z.object({
  id: z.string(),
  type: z.enum([
    "email",
    "phone",
    "sns-handle",
    "financial",
    "personal-opinion",
    "credential",
    "other",
  ]),
  excerpt: z.string(),
  location: z.string(),
  suggestion: z.string(),
});

export type SensitiveItem = z.infer<typeof SensitiveItemSchema>;

const CreateOperationSchema = z.object({
  type: z.literal("create"),
  tempId: z.string(),
  suggestedTitle: z.object({ ja: z.string() }),
  suggestedParentId: z.string().nullable(),
  pageType: z.enum([
    "event-report",
    "speaker-profile",
    "project-log",
    "how-to-guide",
    "onboarding-guide",
    "survey-report",
  ]),
  rationale: z.string(),
});

const UpdateOperationSchema = z.object({
  type: z.literal("update"),
  pageId: z.string(),
  pageTitle: z.string(),
  rationale: z.string(),
});

const OperationSchema = z.discriminatedUnion("type", [
  CreateOperationSchema,
  UpdateOperationSchema,
]);

export const OperationPlanSchema = z.object({
  planRationale: z.string(),
  operations: z.array(OperationSchema).max(5),
});

export type OperationPlan = z.infer<typeof OperationPlanSchema>;
export type CreateOperation = z.infer<typeof CreateOperationSchema>;
export type UpdateOperation = z.infer<typeof UpdateOperationSchema>;

const SectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
  sectionType: z.enum([
    "overview",
    "steps",
    "tips",
    "retrospective-good",
    "retrospective-improve",
    "checklist",
    "contact",
    "handover",
    "faq",
    "other",
  ]),
});

export const PageDraftSchema = z.object({
  suggestedPageType: z.enum([
    "event-report",
    "speaker-profile",
    "project-log",
    "how-to-guide",
    "onboarding-guide",
    "survey-report",
  ]),
  pageTypeConfidence: z.enum(["high", "medium", "low"]),
  title: z.object({ ja: z.string() }),
  summary: z.object({ ja: z.string() }),
  metadata: z.record(z.string(), z.string()),
  sections: z.array(SectionSchema),
  suggestedParentId: z.string().nullable(),
  suggestedTags: z.array(z.string()).max(5),
  suggestedSlug: z.string().optional(),
  actionabilityScore: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  actionabilityNotes: z.string(),
  sensitiveItems: z.array(SensitiveItemSchema),
});

export type PageDraft = z.infer<typeof PageDraftSchema>;

const SectionPatchSchema = z.object({
  headingMatch: z.string().nullable(),
  operation: z.enum(["append", "prepend"]),
  newHeading: z.string().optional(),
  content: z.string(),
});

export const SectionPatchResponseSchema = z.object({
  pageId: z.string(),
  sectionPatches: z.array(SectionPatchSchema),
  sensitiveItems: z.array(SensitiveItemSchema),
  actionabilityScore: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  actionabilityNotes: z.string(),
});

export type SectionPatchResponse = z.infer<typeof SectionPatchResponseSchema>;

const ClarificationQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  context: z.string(),
  suggestions: z.array(z.string()).optional(),
});

export const ClarificationResultSchema = z.object({
  needsClarification: z.boolean(),
  questions: z.array(ClarificationQuestionSchema).max(4),
  summary: z.string(),
});

export type ClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>;
export type ClarificationResult = z.infer<typeof ClarificationResultSchema>;

export interface PageIndexEntry {
  id: string;
  title: string;
  summary: string;
  slug: string;
  parentId: string | null;
}
