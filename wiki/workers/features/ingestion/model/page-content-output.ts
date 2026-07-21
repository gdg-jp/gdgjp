import { z } from "zod";
import {
  CreateOperationSchema,
  type PageDraft,
  PageDraftSchema,
  type SectionPatchResponse,
  SectionPatchResponseSchema,
  SensitiveItemSchema,
} from "../../../../shared/ingestion/domain";

const ActionabilityScoreOutputSchema = z
  .enum(["1", "2", "3"])
  .describe("Actionability score as one of the strings: 1, 2, or 3")
  .transform((value) => Number(value));

const MetadataEntryOutputSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

const SectionOutputSchema = z.object({
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

const SectionPatchOutputSchema = z.object({
  headingMatch: z.string().nullable(),
  operation: z.enum(["append", "prepend"]),
  newHeading: z.string().nullable(),
  content: z.string(),
});

/** Gemini-compatible PageDraft shape without unions or record schemas. */
export const PageDraftOutputSchema: z.ZodType<PageDraft> = z
  .object({
    suggestedPageType: CreateOperationSchema.shape.pageType,
    pageTypeConfidence: z.enum(["high", "medium", "low"]),
    title: z.object({ ja: z.string() }),
    summary: z.object({ ja: z.string() }),
    metadataEntries: z
      .array(MetadataEntryOutputSchema)
      .max(30)
      .describe("Page metadata as key/value rows. Use an empty array when there is no metadata."),
    sections: z.array(SectionOutputSchema),
    suggestedParentId: z.string().nullable(),
    suggestedTags: z.array(z.string()).max(5),
    suggestedSlug: z.string().nullable(),
    actionabilityScore: ActionabilityScoreOutputSchema,
    actionabilityNotes: z.string(),
    sensitiveItems: z.array(SensitiveItemSchema),
  })
  .transform(({ metadataEntries, ...output }) =>
    PageDraftSchema.parse({
      ...output,
      metadata: Object.fromEntries(metadataEntries.map(({ key, value }) => [key, value])),
    }),
  );

/** Gemini-compatible SectionPatchResponse shape without numeric literal unions. */
export const SectionPatchResponseOutputSchema: z.ZodType<SectionPatchResponse> = z
  .object({
    pageId: z.string(),
    sectionPatches: z.array(SectionPatchOutputSchema),
    sensitiveItems: z.array(SensitiveItemSchema),
    actionabilityScore: ActionabilityScoreOutputSchema,
    actionabilityNotes: z.string(),
  })
  .transform((output) => SectionPatchResponseSchema.parse(output));
