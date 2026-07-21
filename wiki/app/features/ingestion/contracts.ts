import { z } from "zod";
import type { ExtractedUrl } from "~/lib/url-extract";

export const SensitiveItemSchema = z.object({
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

export const CreateOperationSchema = z.object({
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

export const UpdateOperationSchema = z.object({
  type: z.literal("update"),
  pageId: z.string(),
  pageTitle: z.string(),
  rationale: z.string(),
});

export const OperationPlanSchema = z.object({
  planRationale: z.string(),
  operations: z
    .array(z.discriminatedUnion("type", [CreateOperationSchema, UpdateOperationSchema]))
    .max(5),
});

export type CreateOperation = z.infer<typeof CreateOperationSchema>;
export type UpdateOperation = z.infer<typeof UpdateOperationSchema>;
export type OperationPlan = z.infer<typeof OperationPlanSchema>;

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
  suggestedPageType: CreateOperationSchema.shape.pageType,
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

export const ClarificationQuestionSchema = z.object({
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

export interface SourceUrl {
  url: string;
  title: string;
}

export interface IngestionInputs {
  texts: string[];
  imageKeys: string[];
  googleDocUrls: string[];
  imageFiles?: Array<{ key: string; buffer: ArrayBuffer; mimeType: string; name: string }>;
  pdfKeys?: string[];
  pdfFiles?: Array<{ key: string; buffer: ArrayBuffer; mimeType: string; name: string }>;
  googleFormUrl?: string;
  eventTitle?: string;
}

export interface ChangesetOperation {
  type: "create" | "update";
  tempId?: string;
  pageId?: string;
  pageTitle?: string;
  rationale: string;
  draft: PageDraft | null;
  patch: SectionPatchResponse | null;
  existingTipTapJson?: string;
}

export type AiDraftJson =
  | {
      phase: "clarification";
      questions: ClarificationQuestion[];
      summary: string;
      fileUris: { uri: string; mimeType: string }[];
      googleDocText?: string;
      sourceArtifactKey?: string;
      sources?: SourceUrl[];
    }
  | {
      phase: "url_selection";
      urls: ExtractedUrl[];
      fileUris: { uri: string; mimeType: string }[];
      googleDocText?: string;
      sourceArtifactKey?: string;
    }
  | {
      phase: "resume_post_clarification";
      fileUris: { uri: string; mimeType: string }[];
      clarificationAnswers: string;
      googleDocText?: string;
      sourceArtifactKey?: string;
      sources?: SourceUrl[];
    }
  | {
      phase: "resume_post_url_selection";
      fileUris: { uri: string; mimeType: string }[];
      selectedUrls: string[];
      googleDocText?: string;
      sourceArtifactKey?: string;
    }
  | {
      phase?: "result";
      planRationale: string;
      operations: ChangesetOperation[];
      sensitiveItems: SensitiveItem[];
      warnings: string[];
      sources: SourceUrl[];
      imageKeys: string[];
      pdfKeys: string[];
    };

export type IngestionResumePostClarificationDraft = Extract<
  AiDraftJson,
  { phase: "resume_post_clarification" }
>;

export type IngestionResumePostUrlSelectionDraft = Extract<
  AiDraftJson,
  { phase: "resume_post_url_selection" }
>;

export interface AccessContext {
  userId: string;
  email: string;
  isAdmin: boolean;
  chapterIds: string[];
  capturedAt: string;
  claimsAvailable: boolean;
  source: "web" | "discord" | "system";
}

export type IngestionChannel = "web" | "analysis" | "discord" | "google_chat";

export interface IngestionRequest {
  sessionId: string;
  actorId: string;
  channel: IngestionChannel;
  access: AccessContext;
}

export function createAccessContext(input: {
  userId: string;
  email?: string | null;
  isAdmin?: boolean | null;
  chapterIds?: readonly string[];
  claimsAvailable: boolean;
  source: AccessContext["source"];
}): AccessContext {
  return {
    userId: input.userId,
    email: input.email?.trim().toLowerCase() ?? "",
    isAdmin: input.isAdmin === true,
    chapterIds: [...new Set(input.chapterIds ?? [])],
    capturedAt: new Date().toISOString(),
    claimsAvailable: input.claimsAvailable,
    source: input.source,
  };
}

export interface GenerationAgentState {
  sessionId: string | null;
  workflowId: string | null;
  status:
    | "idle"
    | "processing"
    | "awaiting_url_selection"
    | "awaiting_clarification"
    | "done"
    | "error";
  phaseMessage: string | null;
  errorMessage: string | null;
  revision: number;
}
