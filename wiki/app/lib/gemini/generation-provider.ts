import type { ContentListUnion } from "@google/genai";
import type {
  ClarificationResult,
  CreateOperation,
  OperationPlan,
  PageDraft,
  PageIndexEntry,
  SectionPatchResponse,
  UpdateOperation,
} from "./types";

/** A file already made available to the selected model provider. */
export interface GenerationFileReference {
  mimeType: string;
  uri: string;
}

export interface ClarifyGenerationInput {
  currentDatetime: string;
  files: GenerationFileReference[];
  userText: string;
}

export interface PlanGenerationInput extends ClarifyGenerationInput {
  pageIndex: PageIndexEntry[];
}

export interface CreateGenerationInput extends PlanGenerationInput {
  imageNames?: string[];
  operation: CreateOperation;
  siblingOperations: CreateOperation[];
}

export interface PatchGenerationInput extends ClarifyGenerationInput {
  existingMarkdown: string;
  imageNames?: string[];
  operation: UpdateOperation;
}

export interface TranslationGenerationInput {
  contentJa: string;
  summaryJa: string;
  titleJa: string;
}

export interface PdfConversionInput {
  fileUri: string;
  sourceUrl: string;
}

export interface SearchAnswerInput {
  evidence: Array<{ title: string; slug: string; chunks: string[] }>;
  query: string;
}

export interface TokenCountInput {
  /** Include the system instruction so the result represents the full prompt. */
  systemInstruction?: string;
  contents: ContentListUnion;
  model?: string;
}

export interface TokenCount {
  inputTokens: number;
  model: string;
}

/**
 * Model-neutral contract used by ingestion, regeneration, and future channels.
 *
 * Implementations must validate every structured response before returning it.
 */
export interface GenerationProvider {
  readonly model: string;

  clarify(input: ClarifyGenerationInput): Promise<ClarificationResult>;
  plan(input: PlanGenerationInput): Promise<OperationPlan>;
  create(input: CreateGenerationInput): Promise<PageDraft>;
  patch(input: PatchGenerationInput): Promise<SectionPatchResponse>;
  translate(
    input: TranslationGenerationInput,
  ): Promise<{ contentEn: string; summaryEn: string; titleEn: string }>;
  convertPdf(input: PdfConversionInput): Promise<string>;
  answerSearch(input: SearchAnswerInput): Promise<string>;
  countTokens(input: TokenCountInput): Promise<TokenCount>;
}
